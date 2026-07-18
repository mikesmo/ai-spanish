/**
 * Clears ALL saved progress for the current user: every lesson's saved
 * checkpoint + completion history, lifetime word/grammar mastery, and the
 * declared CEFR level. Development-only — the API route itself is gated by
 * NODE_ENV.
 */
export async function resetAllLearnerProgress(): Promise<boolean> {
  try {
    const res = await fetch('/api/dev/reset-progress', {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[learnerProgressReset] DELETE failed', res.status, text.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[learnerProgressReset] DELETE error', err);
    return false;
  }
}
