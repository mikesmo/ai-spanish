import {
  buildGrammarItemsByMastery,
  completedLessonsListResponseSchema,
  lessonSessionCompletionPayloadSchema,
  selectGrammarItemsForSummary,
  sessionHistoryGetResponseSchema,
} from '@ai-spanish/logic';
import { type NextRequest, NextResponse } from 'next/server';
import { resolveAuthenticatedSupabaseForApi } from '@/lib/auth/resolveAuthenticatedSupabaseForApi';
import { generateGrammarSummaries } from '@/lib/grammarSummaryService';

function jsonError(status: number, message: string, issues?: unknown): NextResponse {
  return NextResponse.json(
    issues !== undefined ? { error: message, issues } : { error: message },
    { status },
  );
}

/** POST authenticated — upsert lesson completion snapshot (idempotent on runId per user). */
export async function POST(request: NextRequest): Promise<Response> {
  const auth = await resolveAuthenticatedSupabaseForApi(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  if (typeof body !== 'object' || body === null || !('payload' in body)) {
    return jsonError(400, 'Expected JSON object with payload');
  }

  const rawPayload = (body as { payload?: unknown }).payload;
  const parsedPayload = lessonSessionCompletionPayloadSchema.safeParse(rawPayload);
  if (!parsedPayload.success) {
    return jsonError(400, 'Invalid payload', parsedPayload.error.issues);
  }

  const payload = parsedPayload.data;
  const completedAtIso = new Date(payload.completedAtMs).toISOString();

  // Generate AI grammar summaries synchronously before persisting so they are
  // baked into the stored payload. Skip when ANTHROPIC_API_KEY is absent.
  let payloadToStore = payload;
  if (process.env.ANTHROPIC_API_KEY) {
    const grammarRows = buildGrammarItemsByMastery(
      payload.entries,
      payload.checkpoint.grammarItemScores ?? {},
      payload.checkpoint.incorrectPhraseRecords ?? [],
    );
    const targets = selectGrammarItemsForSummary(grammarRows);
    if (targets.length > 0) {
      const grammarSummaries = await generateGrammarSummaries(targets, payload.entries);
      payloadToStore = { ...payload, grammarSummaries };
    }
  }

  const { error } = await auth.data.supabase.from('user_lesson_completions').upsert(
    {
      user_id: auth.data.userId,
      run_id: payloadToStore.runId,
      lesson_id: payloadToStore.lessonId,
      completed_at: completedAtIso,
      payload: payloadToStore,
    },
    { onConflict: 'user_id,run_id' },
  );

  if (error) {
    return jsonError(
      500,
      error.message ?? 'Failed to persist lesson completion',
    );
  }

  return NextResponse.json(
    {
      lessonId: payload.lessonId,
      runId: payload.runId,
      completedAt: completedAtIso,
    },
    { status: 201 },
  );
}

/**
 * GET — two modes:
 *   - With `?lesson=id`: latest stored completion for the authenticated user
 *     and lesson, shape matches SessionHistoryGetResponse for existing log
 *     viewers.
 *   - Without `?lesson`: list of distinct lesson_ids the user has at least
 *     one completion for (used by the home page to decide whether to show
 *     the Report link).
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await resolveAuthenticatedSupabaseForApi(request);
  if (!auth.ok) return auth.response;

  const lesson = request.nextUrl.searchParams.get('lesson')?.trim() ?? '';
  if (!lesson) {
    const { data, error } = await auth.data.supabase
      .from('user_lesson_completions')
      .select('lesson_id');

    if (error) {
      return jsonError(
        500,
        error.message ?? 'Failed to load completed lessons',
      );
    }

    const ids = Array.from(
      new Set(
        (data ?? [])
          .map((row) => (row as { lesson_id?: unknown }).lesson_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0),
      ),
    );

    const response = completedLessonsListResponseSchema.parse({
      completedLessonIds: ids,
    });
    return NextResponse.json(response);
  }

  const { data, error } = await auth.data.supabase
    .from('user_lesson_completions')
    .select('payload')
    .eq('lesson_id', lesson)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return jsonError(
      500,
      error.message ?? 'Failed to load lesson completion',
    );
  }

  const rawPayload = data?.payload;
  const parsedBase = lessonSessionCompletionPayloadSchema.safeParse(rawPayload);
  if (!parsedBase.success || rawPayload == null) {
    const empty: unknown = sessionHistoryGetResponseSchema.parse({
      lessonId: lesson,
      entries: [],
      latestCheckpoint: null,
    });
    return NextResponse.json(empty);
  }

  const p = parsedBase.data;
  const response: unknown = sessionHistoryGetResponseSchema.parse({
    lessonId: p.lessonId,
    entries: p.entries,
    latestCheckpoint: p.checkpoint,
    grammarSummaries: p.grammarSummaries,
  });
  return NextResponse.json(response);
}
