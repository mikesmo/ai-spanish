import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse, type NextRequest } from 'next/server';
import {
  AUDIO_CLIP_SEGMENTS,
  AUDIO_PHRASE_NAME_PATTERN,
  buildS3AudioKey,
  isAudioClipSegment,
  normalizeAudioContentPrefix,
  normalizeLessonSegment,
} from '@ai-spanish/logic';
import { assertApiUser } from '@/lib/auth/assert-api-user';

/**
 * GET /api/audio?phrase=<phraseName>&segment=<segment>[&lesson=<lesson>]
 *
 * Returns a short-lived presigned S3 URL for the requested audio clip.
 * The S3 key is derived as: {prefix}[/{lesson}]/audio/{phrase}-{segment}.mp3
 *
 * Requires a valid Supabase session (see middleware and assertApiUser).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = request.nextUrl;
  const phraseRaw = searchParams.get('phrase');
  const segment = searchParams.get('segment');
  const lessonParam = searchParams.get('lesson') ?? undefined;

  if (!phraseRaw || !AUDIO_PHRASE_NAME_PATTERN.test(phraseRaw)) {
    return NextResponse.json(
      { error: 'Invalid phrase: must be a non-empty slug (a-z, 0-9, -)' },
      { status: 400 }
    );
  }

  if (!segment || !isAudioClipSegment(segment)) {
    return NextResponse.json(
      { error: `Invalid segment: must be one of ${AUDIO_CLIP_SEGMENTS.join(', ')}` },
      { status: 400 }
    );
  }

  const bucket = process.env.S3_BUCKET_NAME?.trim();
  if (!bucket) {
    return NextResponse.json({ error: 'S3 not configured' }, { status: 503 });
  }

  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const prefix = normalizeAudioContentPrefix(process.env.AUDIO_CONTENT_PREFIX);
  const lesson = normalizeLessonSegment(lessonParam ?? process.env.S3_LESSON ?? undefined);

  const jobId = `${phraseRaw}-${segment}`;
  const s3Key = buildS3AudioKey(prefix, lesson, jobId);

  try {
    const client = new S3Client({ region });
    const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
    const url = await getSignedUrl(client, command, { expiresIn: 300 });

    const response = NextResponse.json({ url, expiresIn: 300 });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (err) {
    console.error('[/api/audio] S3 presign error:', err);
    return NextResponse.json({ error: 'Failed to generate audio URL' }, { status: 500 });
  }
}
