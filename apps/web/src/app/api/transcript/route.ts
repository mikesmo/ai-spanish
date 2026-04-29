import { type NextRequest, NextResponse } from 'next/server';

import { transcriptResponseSchema } from '@ai-spanish/logic';

import { assertApiUser } from '@/lib/auth/assert-api-user';
import {
  fetchLessonTranscriptPhrases,
  getLessonTranscriptDbEnv,
  upsertLessonTranscriptPhrases,
} from '@/server/lesson-transcript-repository';

const DEFAULT_LESSON = '1';
const VALID_LESSON_IDS = new Set(['1', '2']);

function resolveLessonId(raw: string | null): string {
  if (raw == null || raw === '' || !VALID_LESSON_IDS.has(raw)) {
    return DEFAULT_LESSON;
  }
  return raw;
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

export async function GET(request: NextRequest) {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  if (!getLessonTranscriptDbEnv()) {
    return transcriptStorageMisconfiguredResponse();
  }

  try {
    const lessonId = resolveLessonId(
      request.nextUrl.searchParams.get('lesson'),
    );
    const phrases = await fetchLessonTranscriptPhrases(lessonId);
    return NextResponse.json(phrases);
  } catch (error) {
    console.error('Error loading transcript data:', error);
    return NextResponse.json(
      { error: 'Failed to load phrases' },
      { status: 500 },
    );
  }
}

function resolvePayload(body: unknown): unknown {
  if (Array.isArray(body)) {
    return body;
  }
  if (
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'phrases' in body
  ) {
    return (body as { phrases: unknown }).phrases;
  }
  return body;
}

async function handlePut(request: NextRequest): Promise<NextResponse> {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  if (!getLessonTranscriptDbEnv()) {
    return transcriptStorageMisconfiguredResponse();
  }

  const lessonId = resolveLessonId(request.nextUrl.searchParams.get('lesson'));

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const payload = resolvePayload(bodyJson);
  const parsed = transcriptResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Transcript payload failed validation', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await upsertLessonTranscriptPhrases(lessonId, parsed.data);
    const phrases = await fetchLessonTranscriptPhrases(lessonId);
    return NextResponse.json(phrases);
  } catch (error) {
    console.error('Error saving transcript:', error);
    return NextResponse.json(
      { error: 'Failed to save transcript' },
      { status: 500 },
    );
  }
}

export const PUT = handlePut;
export const PATCH = handlePut;
