import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse, type NextRequest } from 'next/server';
import {
  audioBatchPresignRequestSchema,
  buildS3AudioFolderPrefix,
  buildS3AudioKey,
  lessonAudioClipId,
  normalizeAudioContentPrefix,
  normalizeLessonSegment,
  type AudioBatchPresignResponse,
} from '@ai-spanish/logic';
import { assertApiUser } from '@/lib/auth/assert-api-user';

/** Long enough for a whole lesson; clients re-presign single clips after expiry. */
const BATCH_PRESIGN_EXPIRES_IN_S = 3600;

/** S3 key → ETag (unquoted) for every object under `prefix`. */
async function listObjectVersions(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of page.Contents ?? []) {
      if (obj.Key && obj.ETag) versions.set(obj.Key, obj.ETag.replace(/"/g, ''));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return versions;
}

/**
 * POST /api/audio/batch
 * Body: `{ lesson?, clips: [{ phrase, segment }] }`.
 *
 * One auth check and one S3 listing for a whole lesson, instead of one
 * `/api/audio` round trip per clip. Returns presigned URLs only for clips that
 * exist in S3, each with its ETag as a content version for client caches.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = audioBatchPresignRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const bucket = process.env.S3_BUCKET_NAME?.trim();
  if (!bucket) {
    return NextResponse.json({ error: 'S3 not configured' }, { status: 503 });
  }

  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  let prefix: string;
  let lesson: string | undefined;
  try {
    prefix = normalizeAudioContentPrefix(process.env.AUDIO_CONTENT_PREFIX);
    lesson = normalizeLessonSegment(parsed.data.lesson ?? process.env.S3_LESSON ?? undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const client = new S3Client({ region });
    const versions = await listObjectVersions(
      client,
      bucket,
      buildS3AudioFolderPrefix(prefix, lesson),
    );

    const clips: AudioBatchPresignResponse['clips'] = {};
    await Promise.all(
      parsed.data.clips.map(async ({ phrase, segment }) => {
        const id = lessonAudioClipId(phrase, segment);
        const key = buildS3AudioKey(prefix, lesson, id);
        const version = versions.get(key);
        if (!version) return;
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { expiresIn: BATCH_PRESIGN_EXPIRES_IN_S },
        );
        clips[id] = { url, version };
      }),
    );

    const payload: AudioBatchPresignResponse = {
      expiresIn: BATCH_PRESIGN_EXPIRES_IN_S,
      clips,
    };
    const response = NextResponse.json(payload);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (err) {
    console.error('[/api/audio/batch] S3 list/presign error:', err);
    return NextResponse.json({ error: 'Failed to generate audio URLs' }, { status: 500 });
  }
}
