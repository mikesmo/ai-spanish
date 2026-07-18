import { type NextRequest, NextResponse } from 'next/server';
import { resolveAuthenticatedSupabaseForApi } from '@/lib/auth/resolveAuthenticatedSupabaseForApi';

function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

const PROGRESS_TABLES = [
  'user_lesson_progress',
  'user_lesson_completions',
  'user_word_mastery',
  'user_grammar_mastery',
  'user_profile',
] as const;

/**
 * DELETE — development-only. Wipes every row owned by the authenticated user
 * across all progress tables: in-progress checkpoints, completion history,
 * lifetime word/grammar mastery, and the declared CEFR level.
 *
 * Gated server-side (not just by hiding the button) since this is
 * irreversible; 404s outside development, mirroring the `/dev/*` page guard.
 */
export async function DELETE(request: NextRequest): Promise<Response> {
  if (process.env.NODE_ENV !== 'development') {
    return jsonError(404, 'Not found');
  }

  const auth = await resolveAuthenticatedSupabaseForApi(request);
  if (!auth.ok) return auth.response;

  const { userId, supabase } = auth.data;

  for (const table of PROGRESS_TABLES) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId);
    if (error) {
      return jsonError(500, error.message ?? `Failed to clear ${table}`);
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
