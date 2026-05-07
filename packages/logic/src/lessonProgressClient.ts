import {
  sessionCheckpointSchema,
  type SessionCheckpointParsed,
} from './schemas/sessionCheckpoint';

/**
 * Platform-agnostic HTTP transport for the lesson-progress API.
 *
 * Each platform supplies its own implementation that adds the correct auth
 * headers and base URL:
 *   - Web: cookie-based session (`credentials: 'include'`, relative paths).
 *   - Mobile: Bearer token from Supabase, absolute URLs via `WEB_ORIGIN`.
 */
export type LessonProgressFetcher = (
  path: string,
  init: RequestInit,
) => Promise<Response>;

/**
 * Fetches the persisted in-progress checkpoint for `lessonId`.
 *
 * Returns `null` when there is no resumable checkpoint (never saved, already
 * deleted, or stored blob fails schema validation). React Query callers should
 * treat `null` as "start fresh".
 */
export async function fetchLessonResumeCheckpoint(
  fetcher: LessonProgressFetcher,
  lessonId: string,
): Promise<SessionCheckpointParsed | null> {
  const res = await fetcher(
    `/api/lesson-progress?lesson=${encodeURIComponent(lessonId)}`,
    { method: 'GET' },
  );
  if (!res.ok) {
    throw new Error(`lesson-progress GET failed: ${res.status}`);
  }
  const json: unknown = await res.json();
  const checkpointUnknown =
    typeof json === 'object' && json !== null && 'checkpoint' in json
      ? (json as { checkpoint: unknown }).checkpoint
      : undefined;
  if (checkpointUnknown === undefined || checkpointUnknown === null) {
    return null;
  }
  const parsed = sessionCheckpointSchema.safeParse(checkpointUnknown);
  return parsed.success ? parsed.data : null;
}

/**
 * Upserts a mid-flight checkpoint for the authenticated user.
 *
 * Returns `true` when the server accepted the checkpoint (2xx).
 */
export async function putLessonProgressCheckpoint(
  fetcher: LessonProgressFetcher,
  checkpoint: SessionCheckpointParsed,
  options?: { keepalive?: boolean },
): Promise<boolean> {
  try {
    const res = await fetcher('/api/lesson-progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lessonId: checkpoint.lessonId,
        checkpoint,
      }),
      keepalive: options?.keepalive === true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Deletes the saved progress row for `lessonId` (call after lesson completion
 * so the next session starts fresh).
 *
 * Returns `true` when the server confirmed deletion (2xx).
 */
export async function deleteLessonProgress(
  fetcher: LessonProgressFetcher,
  lessonId: string,
): Promise<boolean> {
  try {
    const res = await fetcher(
      `/api/lesson-progress?lesson=${encodeURIComponent(lessonId)}`,
      { method: 'DELETE' },
    );
    return res.ok;
  } catch {
    return false;
  }
}
