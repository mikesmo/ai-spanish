import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import path from 'node:path';
import { type NextRequest, NextResponse } from 'next/server';

import {
  buildS3AudioKey,
  findDuplicatePhraseNames,
  mergePhraseSegmentText,
  normalizeAudioContentPrefix,
  normalizeLessonSegment,
  phraseClipJobId,
  resolveTranscriptLessonQueryParam,
  s3LessonFolderForTranscriptLessonId,
  transcriptResponseSchema,
} from '@ai-spanish/logic';
import { assertApiUser } from '@/lib/auth/assert-api-user';
import {
  fetchLessonTranscriptPhrases,
  getLessonTranscriptDbEnv,
  upsertLessonTranscriptPhrases,
} from '@/server/lesson-transcript-repository';

/** Matches POST `/api/lesson-audio-synthesize` phrase slug validation. */
const PHRASE_NAME_PATTERN = /^[a-z0-9-]+$/;

const CLEARABLE_SEGMENTS = ['follow-up', 'explain'] as const;
type ClearableSegment = (typeof CLEARABLE_SEGMENTS)[number];

function isClearableSegment(s: string): s is ClearableSegment {
  return (CLEARABLE_SEGMENTS as readonly string[]).includes(s);
}

function transcriptStorageMisconfiguredResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        'Transcript storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    },
    { status: 503 },
  );
}

function s3MisconfiguredResponse(): NextResponse {
  return NextResponse.json(
    { error: 'S3 not configured (S3_BUCKET_NAME)' },
    { status: 503 },
  );
}

function manifestObjectKey(prefix: string, lessonSeg: string | undefined): string {
  const base = lessonSeg ? path.posix.join(prefix, lessonSeg) : prefix;
  return path.posix.join(base, 'manifest.json');
}

/**
 * POST /api/lesson-audio/clear-segment
 * Clears follow-up or explain text in Supabase, deletes the S3 MP3, and removes the clip from manifest.json.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  if (!getLessonTranscriptDbEnv()) {
    return transcriptStorageMisconfiguredResponse();
  }

  const bucket = process.env.S3_BUCKET_NAME?.trim();
  if (!bucket) {
    return s3MisconfiguredResponse();
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (bodyJson === null || typeof bodyJson !== 'object' || Array.isArray(bodyJson)) {
    return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });
  }

  const o = bodyJson as Record<string, unknown>;
  let lessonParam: string | null = null;
  if ('lesson' in o) {
    const l = o.lesson;
    if (typeof l === 'string') lessonParam = l;
    else if (typeof l === 'number' && Number.isFinite(l)) lessonParam = String(Math.trunc(l));
  }
  const lessonId = resolveTranscriptLessonQueryParam(lessonParam);

  let phraseIndex: number | undefined;
  const pi = o.phraseIndex;
  if (typeof pi === 'number' && Number.isFinite(pi)) {
    phraseIndex = Math.trunc(pi);
  } else if (typeof pi === 'string') {
    const t = pi.trim();
    if (/^-?\d+$/.test(t)) phraseIndex = parseInt(t, 10);
  }

  const segmentRaw = typeof o.segment === 'string' ? o.segment.trim() : '';
  const phraseNameRaw = typeof o.phrase === 'string' ? o.phrase.trim() : '';

  if (phraseIndex === undefined || phraseIndex < 0) {
    return NextResponse.json({ error: 'phraseIndex must be a non-negative integer' }, { status: 400 });
  }

  if (!isClearableSegment(segmentRaw)) {
    return NextResponse.json(
      { error: 'segment must be follow-up or explain' },
      { status: 400 },
    );
  }

  if (!phraseNameRaw || !PHRASE_NAME_PATTERN.test(phraseNameRaw)) {
    return NextResponse.json(
      { error: 'phrase must be a non-empty slug (a-z, 0-9, -)' },
      { status: 400 },
    );
  }

  let phrases;
  try {
    phrases = await fetchLessonTranscriptPhrases(lessonId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const dupNames = findDuplicatePhraseNames(phrases);
  if (dupNames.length > 0) {
    return NextResponse.json(
      {
        error: 'Lesson has duplicate phrase names; fix storage before clearing.',
        duplicateNames: dupNames,
      },
      { status: 409 },
    );
  }

  const phraseRow = phrases.find((p) => p.index === phraseIndex);
  if (!phraseRow) {
    return NextResponse.json({ error: `phraseIndex ${phraseIndex} not found in lesson` }, { status: 400 });
  }
  if (phraseRow.name !== phraseNameRaw) {
    return NextResponse.json(
      {
        error: `phrase slug mismatch: expected "${phraseRow.name}" for this index, got "${phraseNameRaw}"`,
      },
      { status: 400 },
    );
  }

  let merged;
  try {
    merged = mergePhraseSegmentText(phrases, phraseIndex, segmentRaw, '');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const parsed = transcriptResponseSchema.safeParse(merged);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Merged transcript failed validation', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await upsertLessonTranscriptPhrases(lessonId, parsed.data);
  } catch (error) {
    console.error('clear-segment transcript save:', error);
    return NextResponse.json({ error: 'Failed to save transcript' }, { status: 500 });
  }

  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  let prefix: string;
  try {
    prefix = normalizeAudioContentPrefix(process.env.AUDIO_CONTENT_PREFIX);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const lessonSeg = normalizeLessonSegment(s3LessonFolderForTranscriptLessonId(lessonId));
  const jobId = phraseClipJobId(phraseNameRaw, segmentRaw);
  const audioKey = buildS3AudioKey(prefix, lessonSeg, jobId);

  const client = new S3Client({ region });

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: audioKey,
      }),
    );
  } catch (delErr) {
    console.error('clear-segment S3 delete:', delErr);
    return NextResponse.json({ error: 'Failed to delete audio object from S3' }, { status: 500 });
  }

  const manifestKey = manifestObjectKey(prefix, lessonSeg);
  try {
    const getOut = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: manifestKey,
      }),
    );
    const bodyText = await getOut.Body?.transformToString();
    if (bodyText) {
      let generatedAt: string | undefined;
      let entries: unknown[];
      const manifestParsed = JSON.parse(bodyText) as unknown;
      if (Array.isArray(manifestParsed)) {
        entries = manifestParsed;
      } else if (
        manifestParsed &&
        typeof manifestParsed === 'object' &&
        !Array.isArray(manifestParsed) &&
        Array.isArray((manifestParsed as { entries?: unknown }).entries)
      ) {
        const m = manifestParsed as { generatedAt?: unknown; entries: unknown[] };
        generatedAt = typeof m.generatedAt === 'string' ? m.generatedAt : undefined;
        entries = m.entries;
      } else {
        entries = [];
      }

      const filtered = entries.filter((row) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) return true;
        const id = (row as { id?: unknown }).id;
        return id !== jobId;
      });

      const outManifest: Record<string, unknown> = {
        entries: filtered,
      };
      if (generatedAt) {
        outManifest.generatedAt = generatedAt;
      } else {
        outManifest.generatedAt = new Date().toISOString();
      }

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: manifestKey,
          Body: `${JSON.stringify(outManifest, null, 2)}\n`,
          ContentType: 'application/json',
        }),
      );
    }
  } catch (getErr: unknown) {
    const n =
      typeof getErr === 'object' && getErr !== null && 'name' in getErr
        ? String((getErr as { name?: string }).name)
        : '';
    const isNotFound = n === 'NoSuchKey';
    if (!isNotFound) {
      console.error('clear-segment manifest read/write:', getErr);
      return NextResponse.json({ error: 'Failed to update manifest on S3' }, { status: 500 });
    }
    // No manifest yet — transcript + audio delete still succeeded
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
