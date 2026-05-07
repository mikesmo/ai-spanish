import {
  deleteLessonProgress as sharedDeleteLessonProgress,
  putLessonProgressCheckpoint as sharedPutLessonProgressCheckpoint,
  type LessonProgressFetcher,
  type SessionCheckpointParsed,
} from '@ai-spanish/logic';

/**
 * Web transport: attaches cookie session (`credentials: 'include'`) and uses
 * relative paths (same-origin Next.js API routes).
 */
export const webLessonProgressFetcher: LessonProgressFetcher = (
  path: string,
  init: RequestInit,
): Promise<Response> =>
  fetch(path, { ...init, credentials: 'include' });

/**
 * Persists mid-lesson checkpoint (queue + progress snapshot) for resume after navigation.
 */
export async function putLessonProgressCheckpoint(
  checkpoint: SessionCheckpointParsed,
  options?: { keepalive?: boolean },
): Promise<boolean> {
  return sharedPutLessonProgressCheckpoint(webLessonProgressFetcher, checkpoint, options);
}

/**
 * Deletes saved progress for a lesson (call after completion).
 */
export async function deleteLessonProgress(lessonId: string): Promise<boolean> {
  return sharedDeleteLessonProgress(webLessonProgressFetcher, lessonId);
}
