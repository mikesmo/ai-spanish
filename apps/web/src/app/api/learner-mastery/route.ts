import {
  learnerMasterySnapshotSchema,
  parseLearnerMasterySnapshot,
  type UserGrammarMasterySelectRow,
  type UserWordMasterySelectRow,
} from '@ai-spanish/logic';
import { type NextRequest, NextResponse } from 'next/server';
import { resolveAuthenticatedSupabaseForApi } from '@/lib/auth/resolveAuthenticatedSupabaseForApi';

function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET — the authenticated user's lifetime word/grammar mastery snapshot,
 * used to seed every new lesson session (`useLessonSession`'s
 * `initialItemScores`) and, later, to power a claimed-vs-proven report.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await resolveAuthenticatedSupabaseForApi(request);
  if (!auth.ok) return auth.response;

  const [wordResult, grammarResult] = await Promise.all([
    auth.data.supabase
      .from('user_word_mastery')
      .select('word, trials_eff, success_sum_eff, stability, mastery, claimed_at_level'),
    auth.data.supabase
      .from('user_grammar_mastery')
      .select(
        'grammar_item, trials_eff, success_sum_eff, stability, mastery, claimed_at_level',
      ),
  ]);

  if (wordResult.error) {
    return jsonError(500, wordResult.error.message ?? 'Failed to load word mastery');
  }
  if (grammarResult.error) {
    return jsonError(500, grammarResult.error.message ?? 'Failed to load grammar mastery');
  }

  const snapshot = parseLearnerMasterySnapshot(
    (wordResult.data ?? []) as UserWordMasterySelectRow[],
    (grammarResult.data ?? []) as UserGrammarMasterySelectRow[],
  );

  return NextResponse.json(learnerMasterySnapshotSchema.parse(snapshot));
}
