import type { SessionCheckpointParsed } from '@ai-spanish/logic';

/**
 * Persists mid-lesson checkpoint (queue + progress snapshot) for resume after navigation.
 */
export async function putLessonProgressCheckpoint(
  checkpoint: SessionCheckpointParsed,
  options?: { keepalive?: boolean },
): Promise<boolean> {
  try {
    const res = await fetch('/api/lesson-progress', {
      method: 'PUT',
      credentials: 'include',
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

export async function deleteLessonProgress(lessonId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/lesson-progress?lesson=${encodeURIComponent(lessonId)}`,
      {
        method: 'DELETE',
        credentials: 'include',
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
