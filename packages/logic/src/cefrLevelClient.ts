import {
  declaredLevelResponseSchema,
  type CefrLevel,
} from './schemas';
import type { LessonProgressFetcher } from './lessonProgressClient';

/** Fetches the authenticated user's declared CEFR level, or `null` if never set / on failure. */
export async function fetchDeclaredLevel(
  fetcher: LessonProgressFetcher,
): Promise<CefrLevel | null> {
  try {
    const res = await fetcher('/api/learner-level', { method: 'GET' });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const parsed = declaredLevelResponseSchema.safeParse(json);
    return parsed.success ? parsed.data.declaredLevel : null;
  } catch {
    return null;
  }
}

/**
 * Declares (or changes) the user's CEFR level. Server-side this seeds
 * "should know" rows for the level's reference words/grammar into the
 * lifetime mastery tables (never resetting already-practiced items).
 *
 * Returns `true` when the server accepted the change (2xx).
 */
export async function putDeclaredLevel(
  fetcher: LessonProgressFetcher,
  level: CefrLevel,
): Promise<boolean> {
  try {
    const res = await fetcher('/api/learner-level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
