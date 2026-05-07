/**
 * Clears saved in-progress checkpoint and all completion history for one lesson.
 */
export async function resetLessonProgressAndCompletions(
  lessonId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/lesson-reset?lesson=${encodeURIComponent(lessonId)}`,
      { method: 'DELETE', credentials: 'include' },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[lessonReset] DELETE failed', res.status, text.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[lessonReset] DELETE error', err);
    return false;
  }
}
