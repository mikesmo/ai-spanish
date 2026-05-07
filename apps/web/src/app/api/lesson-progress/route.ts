import { sessionCheckpointSchema } from '@ai-spanish/logic';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveAuthenticatedSupabaseForApi } from '@/lib/auth/resolveAuthenticatedSupabaseForApi';

function jsonError(status: number, message: string, issues?: unknown): NextResponse {
  return NextResponse.json(
    issues !== undefined ? { error: message, issues } : { error: message },
    { status },
  );
}

/** GET ?lesson= — resume checkpoint only (incomplete runs). */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await resolveAuthenticatedSupabaseForApi(request);
  if (!auth.ok) return auth.response;

  const lessonId = request.nextUrl.searchParams.get('lesson')?.trim() ?? '';
  if (!lessonId) {
    return jsonError(400, 'Missing required query param: lesson');
  }

  const { data, error } = await auth.data.supabase
    .from('user_lesson_progress')
    .select('checkpoint')
    .eq('lesson_id', lessonId)
    .maybeSingle();

  if (error) {
    return jsonError(500, error.message ?? 'Failed to load lesson progress');
  }

  const rawCp = data?.checkpoint;
  const parsed =
    rawCp === undefined || rawCp === null
      ? null
      : sessionCheckpointSchema.safeParse(rawCp);
  const checkpoint = parsed != null && parsed.success ? parsed.data : null;

  return NextResponse.json({ checkpoint });
}

/** Upsert checkpoint for authenticated user while lesson still in flight. */
export async function PUT(request: NextRequest): Promise<Response> {
  const auth = await resolveAuthenticatedSupabaseForApi(request);
  if (!auth.ok) return auth.response;

  let bodyUnknown: unknown;
  try {
    bodyUnknown = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  if (typeof bodyUnknown !== 'object' || bodyUnknown === null) {
    return jsonError(400, 'Expected a JSON object');
  }
  const raw = bodyUnknown as Record<string, unknown>;
  const lessonIdResult = z.string().min(1).safeParse(raw.lessonId);
  const checkpointResult = sessionCheckpointSchema.safeParse(raw.checkpoint);
  if (!lessonIdResult.success) {
    return jsonError(400, 'Invalid lessonId', lessonIdResult.error.issues);
  }
  if (!checkpointResult.success) {
    return jsonError(400, 'Invalid checkpoint', checkpointResult.error.issues);
  }

  const lessonId = lessonIdResult.data;
  const checkpoint = checkpointResult.data;
  if (checkpoint.lessonId !== lessonId) {
    return jsonError(400, 'checkpoint.lessonId must match lessonId');
  }

  const { error } = await auth.data.supabase.from('user_lesson_progress').upsert(
    {
      user_id: auth.data.userId,
      lesson_id: lessonId,
      checkpoint,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,lesson_id' },
  );

  if (error) {
    return jsonError(500, error.message ?? 'Failed to save lesson progress');
  }

  return NextResponse.json({ ok: true, lessonId }, { status: 200 });
}

/** DROP saved progress for lesson (caller e.g. after completion snapshot saved). */
export async function DELETE(request: NextRequest): Promise<Response> {
  const auth = await resolveAuthenticatedSupabaseForApi(request);
  if (!auth.ok) return auth.response;

  const lessonId = request.nextUrl.searchParams.get('lesson')?.trim() ?? '';
  if (!lessonId) {
    return jsonError(400, 'Missing required query param: lesson');
  }

  const { error } = await auth.data.supabase
    .from('user_lesson_progress')
    .delete()
    .eq('lesson_id', lessonId);

  if (error) {
    return jsonError(500, error.message ?? 'Failed to clear lesson progress');
  }

  return NextResponse.json({ ok: true, lessonId });
}
