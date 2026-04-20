import { MASTERY_LEARNING_CEIL, MASTERY_STABILIZING_CEIL } from './mastery';
import type { PhraseProgress } from './types';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Cross-session SRS intervals. */
export const SRS_LEARNING_INTERVAL_MS = 1 * ONE_DAY_MS;
export const SRS_STABILIZING_INTERVAL_MS = 2 * ONE_DAY_MS;
export const SRS_MASTERED_MIN_INTERVAL_MS = 7 * ONE_DAY_MS;
export const SRS_MASTERED_MAX_INTERVAL_MS = 14 * ONE_DAY_MS;

/**
 * Decide when a phrase should next appear. For `learning` and `stabilizing`,
 * the interval is fixed. For `mastered`, we grow the interval geometrically
 * (starting at 7 days, doubling up to 14 days) based on the prior interval.
 */
export function scheduleNextReview(
  prev: PhraseProgress | null,
  next: PhraseProgress,
  now: number,
): number {
  if (next.masteryScore < MASTERY_LEARNING_CEIL) {
    return now + SRS_LEARNING_INTERVAL_MS;
  }
  if (next.masteryScore < MASTERY_STABILIZING_CEIL) {
    return now + SRS_STABILIZING_INTERVAL_MS;
  }

  // Mastered: grow the interval. If the previous review was also mastered,
  // double the last successful interval, capped at the max.
  if (prev && prev.state === 'mastered' && prev.lastSeenAt > 0) {
    const priorInterval = Math.max(
      SRS_MASTERED_MIN_INTERVAL_MS,
      prev.nextReviewAt - prev.lastSeenAt,
    );
    const grown = Math.min(priorInterval * 2, SRS_MASTERED_MAX_INTERVAL_MS);
    return now + grown;
  }
  return now + SRS_MASTERED_MIN_INTERVAL_MS;
}

export function isDueForReview(progress: PhraseProgress, now: number): boolean {
  return progress.nextReviewAt <= now;
}
