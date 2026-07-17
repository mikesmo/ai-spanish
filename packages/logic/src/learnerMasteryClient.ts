import {
  learnerMasterySnapshotSchema,
  type LearnerMasterySnapshot,
} from './schemas/learnerMastery';
import type { LessonProgressFetcher } from './lessonProgressClient';

/**
 * Fetches the authenticated user's lifetime word/grammar mastery snapshot.
 * Reuses the `LessonProgressFetcher` transport type — both platforms' existing
 * fetchers (cookie-auth on web, Bearer-token on mobile) already match this
 * signature, so no new transport is needed.
 *
 * Returns a fully-empty snapshot when the request fails (e.g. unauthenticated)
 * so callers can treat "no seed" the same as "start fresh".
 */
export async function fetchLearnerMasterySnapshot(
  fetcher: LessonProgressFetcher,
): Promise<LearnerMasterySnapshot> {
  const empty: LearnerMasterySnapshot = {
    wordScores: {},
    grammarItemScores: {},
    claimedWordLevels: {},
    claimedGrammarLevels: {},
  };
  try {
    const res = await fetcher('/api/learner-mastery', { method: 'GET' });
    if (!res.ok) return empty;
    const json: unknown = await res.json();
    const parsed = learnerMasterySnapshotSchema.safeParse(json);
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}
