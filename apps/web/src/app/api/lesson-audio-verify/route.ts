import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtemp, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import pLimit from 'p-limit';
import { type NextRequest, NextResponse } from 'next/server';

import type { Phrase, PhraseAudioClipSpec } from '@ai-spanish/logic';
import {
  buildPhraseAudioClipSpecs,
  buildS3AudioKey,
  normalizeAudioContentPrefix,
  normalizeLessonSegment,
  s3LessonFolderForTranscriptLessonId,
} from '@ai-spanish/logic';
import {
  analyzeLoudnessFile,
  resolveMinMaxDbFromEnv,
  resolveMinMeanDbFromEnv,
  verifyMp3BufferMatchesTranscript,
} from '@ai-spanish/audio-verify';
import { assertApiUser } from '@/lib/auth/assert-api-user';

import { readTranscriptFile, resolveLessonIdForFiles } from '@/app/api/_lib/read-lesson-transcript';

export const maxDuration = 300;

interface ClipVerifyResult {
  id: string;
  phraseIndex: number;
  ok: boolean;
  skipped?: boolean;
  loudnessOk?: boolean;
  sttOk?: boolean;
  error?: string;
  transcript?: string;
}

interface PhraseVerifyResult {
  phraseIndex: number;
  verified: boolean;
  clips: ClipVerifyResult[];
}

/**
 * POST /api/lesson-audio-verify
 * Body JSON: `{ lesson?: string, phraseIndex?: number }`.
 * Omit `phraseIndex` to verify every clip in the lesson; set `phraseIndex` to verify clips for one phrase row (progressive Sheets flow).
 * Intended for **local** Next + ngrok (`ENABLE_LESSON_AUDIO_VERIFY=true`, ffmpeg + Deepgram env).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  const enabled = process.env.ENABLE_LESSON_AUDIO_VERIFY?.trim() === 'true';
  if (!enabled) {
    return NextResponse.json(
      {
        ok: false,
        code: 'verification_disabled',
        message:
          'Lesson audio verification is not enabled on this server. Run local Next.js with ENABLE_LESSON_AUDIO_VERIFY=true and point Sheets WEB_ORIGIN at your tunnel (see apps/sheets/README).',
      },
      { status: 503 },
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    bodyJson = {};
  }

  let lessonParam: string | undefined;
  let phraseIndexFilter: number | undefined;
  if (
    bodyJson !== null &&
    typeof bodyJson === 'object' &&
    !Array.isArray(bodyJson)
  ) {
    const o = bodyJson as Record<string, unknown>;
    if ('lesson' in o) {
      const l = o.lesson;
      if (typeof l === 'string') lessonParam = l;
      else if (typeof l === 'number') lessonParam = String(l);
    }
    if ('phraseIndex' in o) {
      const pi = o.phraseIndex;
      if (typeof pi === 'number' && Number.isFinite(pi)) {
        phraseIndexFilter = Math.trunc(pi);
      } else if (typeof pi === 'string') {
        const t = pi.trim();
        if (/^-?\d+$/.test(t)) phraseIndexFilter = parseInt(t, 10);
      }
    }
  }

  let phrases: Phrase[];
  try {
    phrases = readTranscriptFile(lessonParam ?? '');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }

  const canonicalLessonId = resolveLessonIdForFiles(lessonParam ?? '');
  const specs = buildPhraseAudioClipSpecs(phrases);

  if (phraseIndexFilter !== undefined) {
    const transcriptIndices = [...new Set(phrases.map((p) => p.index))];
    if (!transcriptIndices.includes(phraseIndexFilter)) {
      return NextResponse.json(
        {
          ok: false,
          message: `Unknown phrase index: ${phraseIndexFilter}`,
          phrases: [],
        },
        { status: 400 },
      );
    }
  }
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: 'DEEPGRAM_API_KEY is not configured' },
      { status: 503 },
    );
  }
  const deepgramApiKey = apiKey;

  const bucketRaw = process.env.S3_BUCKET_NAME?.trim();
  if (!bucketRaw) {
    return NextResponse.json({ ok: false, message: 'S3 not configured' }, { status: 503 });
  }
  const s3Bucket = bucketRaw;

  let minMaxDb: number;
  let minMeanDb: number;
  try {
    minMaxDb = resolveMinMaxDbFromEnv();
    minMeanDb = resolveMinMeanDbFromEnv();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }

  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const prefix = normalizeAudioContentPrefix(process.env.AUDIO_CONTENT_PREFIX);
  const lessonSeg = normalizeLessonSegment(s3LessonFolderForTranscriptLessonId(canonicalLessonId));

  const s3 = new S3Client({ region });

  async function verifyOne(spec: PhraseAudioClipSpec): Promise<ClipVerifyResult> {
    const key = buildS3AudioKey(prefix, lessonSeg, spec.id);
    let buf: Buffer;
    try {
      const out = await s3.send(
        new GetObjectCommand({
          Bucket: s3Bucket,
          Key: key,
        }),
      );
      const bytes = await out.Body?.transformToByteArray();
      if (!bytes?.length) {
        return {
          id: spec.id,
          phraseIndex: spec.phraseIndex,
          ok: false,
          loudnessOk: false,
          sttOk: false,
          error: 'empty_or_missing_audio',
        };
      }
      buf = Buffer.from(bytes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id: spec.id,
        phraseIndex: spec.phraseIndex,
        ok: false,
        loudnessOk: false,
        sttOk: false,
        error: `s3:${msg}`,
      };
    }

    if (spec.text.trim().length <= 1) {
      return {
        id: spec.id,
        phraseIndex: spec.phraseIndex,
        ok: true,
        skipped: true,
        loudnessOk: true,
        sttOk: true,
      };
    }

    const tmpDir = await mkdtemp(join(tmpdir(), 'ais-vrfy-'));
    const safeName = spec.id.replace(/[^\w.-]/g, '_');
    const tmpPath = join(tmpDir, `${safeName}.mp3`);
    try {
      await writeFile(tmpPath, buf);
      const stats = await analyzeLoudnessFile(tmpPath);
      const loudnessOk = stats.maxDb >= minMaxDb && stats.meanDb >= minMeanDb;
      if (!loudnessOk) {
        return {
          id: spec.id,
          phraseIndex: spec.phraseIndex,
          ok: false,
          loudnessOk,
          sttOk: false,
          error: `loudness_peak_or_mean (${stats.maxDb.toFixed(1)} dB peak, ${stats.meanDb.toFixed(1)} dB mean)`,
        };
      }

      const tr = await verifyMp3BufferMatchesTranscript(
        buf,
        spec.text,
        spec.language,
        deepgramApiKey,
      );
      if (tr.ok) {
        return {
          id: spec.id,
          phraseIndex: spec.phraseIndex,
          ok: true,
          loudnessOk,
          sttOk: true,
        };
      }
      if (tr.kind === 'mismatch') {
        return {
          id: spec.id,
          phraseIndex: spec.phraseIndex,
          ok: false,
          loudnessOk,
          sttOk: false,
          transcript: tr.transcript,
        };
      }
      return {
        id: spec.id,
        phraseIndex: spec.phraseIndex,
        ok: false,
        loudnessOk,
        sttOk: false,
        error: tr.message,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        id: spec.id,
        phraseIndex: spec.phraseIndex,
        ok: false,
        loudnessOk: false,
        sttOk: false,
        error: `loudness:${msg}`,
      };
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  const conc = Math.max(
    1,
    Math.min(parseInt(process.env.LESSON_AUDIO_VERIFY_CONCURRENCY ?? '3', 10) || 3, 8),
  );
  const limit = pLimit(conc);
  const specsToVerify =
    phraseIndexFilter !== undefined ? specs.filter((s) => s.phraseIndex === phraseIndexFilter) : specs;
  const clipsOut = await Promise.all(specsToVerify.map((spec) => limit(() => verifyOne(spec))));

  let phrasesPayload: PhraseVerifyResult[];
  if (phraseIndexFilter !== undefined) {
    const verified = clipsOut.length === 0 || clipsOut.every((c) => c.ok);
    phrasesPayload = [{ phraseIndex: phraseIndexFilter, verified, clips: clipsOut }];
  } else {
    const phraseIndices = [...new Set(phrases.map((p) => p.index))].sort((a, b) => a - b);
    phrasesPayload = phraseIndices.map((phraseIndex) => {
      const clips = clipsOut.filter((c) => c.phraseIndex === phraseIndex);
      const verified = clips.length === 0 || clips.every((c) => c.ok);
      return { phraseIndex, verified, clips };
    });
  }

  const okAll = clipsOut.every((c) => c.ok);
  const fail = clipsOut.filter((c) => !c.ok).length;

  return NextResponse.json(
    {
      ok: okAll,
      lesson: canonicalLessonId,
      clips: clipsOut,
      phrases: phrasesPayload,
      summary: {
        totalClips: clipsOut.length,
        failedClips: fail,
        okAll,
      },
    },
    {
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}
