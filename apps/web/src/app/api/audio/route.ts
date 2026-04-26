import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse, type NextRequest } from 'next/server';
import {
  buildS3AudioKey,
  normalizeAudioContentPrefix,
  normalizeLessonSegment,
} from '@ai-spanish/logic';

/**
 * Allowed segment values — must stay in sync with tts-batch parser job id formula:
 *   {phraseIndex}-en-first-intro, {phraseIndex}-en-second-intro, {phraseIndex}-en-question, {phraseIndex}-es-answer
 */
const ALLOWED_SEGMENTS = [
  'en-first-intro',
  'en-second-intro',
  'en-question',
  'es-answer',
] as const;
type Segment = (typeof ALLOWED_SEGMENTS)[number];

function isAllowedSegment(s: string): s is Segment {
  return (ALLOWED_SEGMENTS as readonly string[]).includes(s);
}

/**
 * GET /api/audio?phrase=<index>&segment=<segment>[&lesson=<lesson>]
 *
 * Returns a short-lived presigned S3 URL for the requested audio clip.
 * The S3 key is derived as: {prefix}[/{lesson}]/audio/{phrase}-{segment}.mp3
 *
 * AUTH PLACEHOLDER: No authentication is enforced in this development phase.
 * TODO: When Supabase Auth (or another auth provider) is ready, validate the
 * session JWT here before generating the presigned URL, e.g.:
 *   const session = await getServerSession(request);
 *   if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const phraseRaw = searchParams.get('phrase');
  const segment = searchParams.get('segment');
  const lessonParam = searchParams.get('lesson') ?? undefined;

  if (!phraseRaw || !/^\d+$/.test(phraseRaw)) {
    return NextResponse.json(
      { error: 'Invalid phrase: must be a non-negative integer' },
      { status: 400 }
    );
  }

  if (!segment || !isAllowedSegment(segment)) {
    return NextResponse.json(
      { error: `Invalid segment: must be one of ${ALLOWED_SEGMENTS.join(', ')}` },
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

  const phrase = parseInt(phraseRaw, 10);
  const jobId = `${phrase}-${segment}`;
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
