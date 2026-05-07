import type { LessonSessionCompletionPayload } from '@ai-spanish/logic';

import { deleteLessonProgress } from './lessonProgressApi';

/**
 * Persists a finished lesson run for the signed-in user (cookie session).
 * On success clears in-progress checkpoint used for resume.
 * Returns whether the snapshot was accepted (2xx).
 */
export async function postLessonCompletion(
  payload: LessonSessionCompletionPayload,
): Promise<boolean> {
  try {
    const res = await fetch('/api/lesson-completions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(
        '[lessonCompletion] POST failed',
        res.status,
        text.slice(0, 200),
      );
      return false;
    }
    const delOk = await deleteLessonProgress(payload.lessonId);
    if (!delOk) {
      console.warn('[lessonCompletion] failed to clear in-progress checkpoint');
    }
    return true;
  } catch (err) {
    console.warn('[lessonCompletion] POST error', err);
    return false;
  }
}
