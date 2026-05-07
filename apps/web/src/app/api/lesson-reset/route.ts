import { type NextRequest, NextResponse } from 'next/server';
import { resolveAuthenticatedSupabaseForApi } from '@/lib/auth/resolveAuthenticatedSupabaseForApi';

function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * DELETE ?lesson=id — remove in-progress checkpoint and all completion snapshots
 * for the authenticated user and lesson (fresh start next visit).
 */
export async function DELETE(request: NextRequest): Promise<Response> {
  const auth = await resolveAuthenticatedSupabaseForApi(request);
  if (!auth.ok) return auth.response;

  const lessonId = request.nextUrl.searchParams.get('lesson')?.trim() ?? '';
  if (!lessonId) {
    return jsonError(400, 'Missing required query param: lesson');
  }

  const { userId, supabase } = auth.data;

  const { error: progressError } = await supabase
    .from('user_lesson_progress')
    .delete()
    .eq('user_id', userId)
    .eq('lesson_id', lessonId);

  if (progressError) {
    return jsonError(
      500,
      progressError.message ?? 'Failed to clear lesson progress',
    );
  }

  const { error: completionsError } = await supabase
    .from('user_lesson_completions')
    .delete()
    .eq('user_id', userId)
    .eq('lesson_id', lessonId);

  if (completionsError) {
    return jsonError(
      500,
      completionsError.message ?? 'Failed to clear lesson completions',
    );
  }

  return NextResponse.json({ ok: true, lessonId }, { status: 200 });
}
