import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { type NextRequest, NextResponse } from 'next/server';

import { fetchTTSAudio } from '@ai-spanish/ai/tts/deepgram';
import { getVoiceForLanguage } from '@ai-spanish/ai/tts/voices';
import { postProcessMp3 } from '@ai-spanish/audio-verify';
import {
  buildS3AudioKey,
  findDuplicatePhraseNames,
  languageForPhraseAudioSegment,
  normalizeAudioContentPrefix,
  normalizeLessonSegment,
  phraseClipJobId,
  s3LessonFolderForTranscriptLessonId,
  isPhraseSynthSegment,
} from '@ai-spanish/logic';
import { assertApiUser } from '@/lib/auth/assert-api-user';

import { loadLessonTranscript, resolveLessonIdForFiles } from '@/app/api/_lib/read-lesson-transcript';

export const maxDuration = 300;

/** Matches GET `/api/audio` phrase slug validation. */
const PHRASE_NAME_PATTERN = /^[a-z0-9-]+$/;

/**
 * POST /api/lesson-audio-synthesize
 * Body JSON: `{ phrase, segment, text, lesson? }` — Deepgram TTS + ffmpeg post-process + S3 PutObject.
 * Requires `ENABLE_LESSON_AUDIO_SYNTHESIZE=true`, `DEEPGRAM_API_KEY`, AWS + bucket env (see apps/sheets/README).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  const enabled = process.env.ENABLE_LESSON_AUDIO_SYNTHESIZE?.trim() === 'true';
  if (!enabled) {
    return NextResponse.json(
      {
        ok: false,
        code: 'synthesize_disabled',
        message:
          'Lesson audio synthesis is not enabled. Run local Next.js with ENABLE_LESSON_AUDIO_SYNTHESIZE=true (see apps/sheets/README).',
      },
      { status: 503 },
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON body' }, { status: 400 });
  }

  if (bodyJson === null || typeof bodyJson !== 'object' || Array.isArray(bodyJson)) {
    return NextResponse.json({ ok: false, message: 'Expected a JSON object' }, { status: 400 });
  }

  const o = bodyJson as Record<string, unknown>;
  const phraseRaw = typeof o.phrase === 'string' ? o.phrase.trim() : '';
  const segmentRaw = typeof o.segment === 'string' ? o.segment.trim() : '';
  const text = typeof o.text === 'string' ? o.text : '';
  let lessonRaw: string | undefined;
  if ('lesson' in o && o.lesson !== undefined && o.lesson !== null) {
    lessonRaw = typeof o.lesson === 'number' ? String(o.lesson) : String(o.lesson).trim();
  }

  if (!phraseRaw || !PHRASE_NAME_PATTERN.test(phraseRaw)) {
    return NextResponse.json(
      { ok: false, message: 'Invalid phrase: must be a non-empty slug (a-z, 0-9, -)' },
      { status: 400 },
    );
  }

  if (!isPhraseSynthSegment(segmentRaw)) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Invalid segment: must be first-intro, second-intro, or answer',
      },
      { status: 400 },
    );
  }

  const segment = segmentRaw;

  if (text.trim().length === 0) {
    return NextResponse.json(
      { ok: false, message: 'text must be a non-empty string for synthesis' },
      { status: 400 },
    );
  }

  let phrases;
  try {
    phrases = await loadLessonTranscript(lessonRaw ?? '');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }

  const dupNames = findDuplicatePhraseNames(phrases);
  if (dupNames.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        message:
          'This lesson has duplicate phrase names in storage; fix names before recording audio.',
        duplicateNames: dupNames,
      },
      { status: 409 },
    );
  }

  const matching = phrases.filter((p) => p.name === phraseRaw);
  if (matching.length === 0) {
    return NextResponse.json(
      { ok: false, message: `Unknown phrase name: ${phraseRaw}` },
      { status: 400 },
    );
  }
  if (matching.length > 1) {
    return NextResponse.json(
      { ok: false, message: `Ambiguous phrase name: ${phraseRaw}` },
      { status: 409 },
    );
  }

  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: 'DEEPGRAM_API_KEY is not configured' },
      { status: 503 },
    );
  }

  const bucket = process.env.S3_BUCKET_NAME?.trim();
  if (!bucket) {
    return NextResponse.json({ ok: false, message: 'S3 not configured' }, { status: 503 });
  }

  const canonicalLessonId = resolveLessonIdForFiles(lessonRaw ?? '');
  const prefix = normalizeAudioContentPrefix(process.env.AUDIO_CONTENT_PREFIX);
  const lessonSeg = normalizeLessonSegment(s3LessonFolderForTranscriptLessonId(canonicalLessonId));
  const jobId = phraseClipJobId(phraseRaw, segment);
  const key = buildS3AudioKey(prefix, lessonSeg, jobId);
  const lang = languageForPhraseAudioSegment(segment);

  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const client = new S3Client({ region });

  const tmpDir = await mkdtemp(join(tmpdir(), 'ais-synth-'));
  const rawMp3 = join(tmpDir, 'clip.mp3');
  try {
    const arrayBuf = await fetchTTSAudio(text, lang, apiKey, getVoiceForLanguage(lang));
    await writeFile(rawMp3, Buffer.from(arrayBuf));
    await postProcessMp3(rawMp3);
    const finalBuf = await readFile(rawMp3);

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: finalBuf,
        ContentType: 'audio/mpeg',
      }),
    );

    return NextResponse.json(
      {
        ok: true,
        lesson: canonicalLessonId,
        phrase: phraseRaw,
        segment,
        jobId,
        s3Key: key,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    console.error('[/api/lesson-audio-synthesize]', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
