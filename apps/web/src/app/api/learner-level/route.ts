import {
  buildClaimedGrammarSeedRows,
  buildClaimedWordSeedRows,
  cefrLevelSchema,
  declaredLevelResponseSchema,
} from '@ai-spanish/logic';
import { type NextRequest, NextResponse } from 'next/server';
import { resolveAuthenticatedSupabaseForApi } from '@/lib/auth/resolveAuthenticatedSupabaseForApi';

function jsonError(status: number, message: string, issues?: unknown): NextResponse {
  return NextResponse.json(
    issues !== undefined ? { error: message, issues } : { error: message },
    { status },
  );
}

/** GET — the authenticated user's self-declared CEFR level, or `null` if never set. */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await resolveAuthenticatedSupabaseForApi(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.data.supabase
    .from('user_profile')
    .select('declared_level')
    .maybeSingle();

  if (error) {
    return jsonError(500, error.message ?? 'Failed to load declared level');
  }

  return NextResponse.json(
    declaredLevelResponseSchema.parse({
      declaredLevel: data?.declared_level ?? null,
    }),
  );
}

/**
 * POST `{ level }` — declares (or changes) the user's CEFR level:
 *   1. Upserts `user_profile.declared_level`.
 *   2. Seeds zero-score, `claimed_at_level`-tagged rows for every word/grammar
 *      item in the level's reference list, never resetting a word/item the
 *      learner has already practiced (`ON CONFLICT DO NOTHING`).
 *   3. Backfills `claimed_at_level` on any of those words/items the learner
 *      already practiced *before* declaring this level, without touching
 *      their scores.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const auth = await resolveAuthenticatedSupabaseForApi(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const levelResult = cefrLevelSchema.safeParse(
    typeof body === 'object' && body !== null ? (body as { level?: unknown }).level : undefined,
  );
  if (!levelResult.success) {
    return jsonError(400, 'Invalid level', levelResult.error.issues);
  }
  const level = levelResult.data;
  const userId = auth.data.userId;
  const nowIso = new Date().toISOString();

  const { error: profileError } = await auth.data.supabase.from('user_profile').upsert(
    {
      user_id: userId,
      declared_level: level,
      declared_level_set_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: 'user_id' },
  );
  if (profileError) {
    return jsonError(500, profileError.message ?? 'Failed to save declared level');
  }

  const [wordsResult, grammarResult] = await Promise.all([
    auth.data.supabase.from('cefr_level_words').select('word').eq('level', level),
    auth.data.supabase.from('cefr_level_grammar').select('grammar_item').eq('level', level),
  ]);
  if (wordsResult.error) {
    return jsonError(500, wordsResult.error.message ?? 'Failed to load reference words');
  }
  if (grammarResult.error) {
    return jsonError(500, grammarResult.error.message ?? 'Failed to load reference grammar');
  }

  const words = (wordsResult.data ?? [])
    .map((row) => (row as { word?: unknown }).word)
    .filter((w): w is string => typeof w === 'string' && w.length > 0);
  const grammarItems = (grammarResult.data ?? [])
    .map((row) => (row as { grammar_item?: unknown }).grammar_item)
    .filter((g): g is string => typeof g === 'string' && g.length > 0);

  if (words.length > 0) {
    const seedRows = buildClaimedWordSeedRows(userId, words, level, nowIso);
    const { error } = await auth.data.supabase
      .from('user_word_mastery')
      .upsert(seedRows, { onConflict: 'user_id,word', ignoreDuplicates: true });
    if (error) {
      return jsonError(500, error.message ?? 'Failed to seed claimed words');
    }

    const { error: backfillError } = await auth.data.supabase
      .from('user_word_mastery')
      .update({ claimed_at_level: level })
      .eq('user_id', userId)
      .is('claimed_at_level', null)
      .in('word', words);
    if (backfillError) {
      return jsonError(500, backfillError.message ?? 'Failed to backfill claimed words');
    }
  }

  if (grammarItems.length > 0) {
    const seedRows = buildClaimedGrammarSeedRows(userId, grammarItems, level, nowIso);
    const { error } = await auth.data.supabase
      .from('user_grammar_mastery')
      .upsert(seedRows, { onConflict: 'user_id,grammar_item', ignoreDuplicates: true });
    if (error) {
      return jsonError(500, error.message ?? 'Failed to seed claimed grammar items');
    }

    const { error: backfillError } = await auth.data.supabase
      .from('user_grammar_mastery')
      .update({ claimed_at_level: level })
      .eq('user_id', userId)
      .is('claimed_at_level', null)
      .in('grammar_item', grammarItems);
    if (backfillError) {
      return jsonError(500, backfillError.message ?? 'Failed to backfill claimed grammar items');
    }
  }

  return NextResponse.json({ ok: true, level }, { status: 200 });
}
