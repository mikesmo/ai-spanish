import { type NextRequest, NextResponse } from 'next/server';

import {
  findDuplicatePhraseNames,
  isPhraseSynthSegment,
  mergePhraseSegmentText,
  resolveTranscriptLessonQueryParam,
  transcriptResponseSchema,
} from '@ai-spanish/logic';
import { assertApiUser } from '@/lib/auth/assert-api-user';
import {
  fetchLessonTranscriptPhrases,
  getLessonTranscriptDbEnv,
  upsertLessonTranscriptPhrases,
} from '@/server/lesson-transcript-repository';

function transcriptStorageMisconfiguredResponse(): NextResponse {
  return NextResponse.json(
    {
      error:
        'Transcript storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    },
    { status: 503 },
  );
}

/**
 * POST /api/transcript/merge-segment
 * Body JSON: `{ phraseIndex, segment, text, lesson? }` — merges one segment into the lesson transcript in Supabase.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await assertApiUser(request);
  if (!auth.ok) return auth.response;

  if (!getLessonTranscriptDbEnv()) {
    return transcriptStorageMisconfiguredResponse();
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
  const text = typeof o.text === 'string' ? o.text : '';

  if (phraseIndex === undefined || phraseIndex < 0) {
    return NextResponse.json({ error: 'phraseIndex must be a non-negative integer' }, { status: 400 });
  }

  if (!isPhraseSynthSegment(segmentRaw)) {
    return NextResponse.json(
      { error: 'segment must be first-intro, second-intro, or answer' },
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
        error: 'Lesson has duplicate phrase names; fix storage before merging.',
        duplicateNames: dupNames,
      },
      { status: 409 },
    );
  }

  let merged;
  try {
    merged = mergePhraseSegmentText(phrases, phraseIndex, segmentRaw, text);
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
    const next = await fetchLessonTranscriptPhrases(lessonId);
    return NextResponse.json(next);
  } catch (error) {
    console.error('merge-segment save:', error);
    return NextResponse.json({ error: 'Failed to save transcript' }, { status: 500 });
  }
}
