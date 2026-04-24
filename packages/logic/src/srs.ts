import type { PhraseProgress, PhraseState } from './types';

/** Lessons until next scheduled review when post-event state is `learning`. */
export const SRS_LEARNING_SESSIONS_OFFSET = 1;
/** Lessons until next review when post-event state is `stabilizing`. */
export const SRS_STABILIZING_SESSIONS_OFFSET = 2;
/** First interval in the `mastered` band (session analogue of ~7d). */
export const SRS_MASTERED_MIN_SESSIONS_OFFSET = 3;
/** Cap for doubled mastered spacing (session analogue of ~14d). */
export const SRS_MASTERED_MAX_SESSIONS_OFFSET = 8;
/** Show Answer / give-up path: review next lesson. */
export const SRS_REVEAL_SESSIONS_OFFSET = 1;

/**
 * How many full lessons from *now* (the current `completedLessonCount`) until
 * this phrase should be scheduled again, based on the post-event mastery band.
 */
export function computeSrsLessonOffset(
  prev: PhraseProgress | null,
  newState: PhraseState,
): number {
  if (newState === 'learning') {
    return SRS_LEARNING_SESSIONS_OFFSET;
  }
  if (newState === 'stabilizing') {
    return SRS_STABILIZING_SESSIONS_OFFSET;
  }
  // mastered
  if (
    prev &&
    prev.state === 'mastered' &&
    prev.srsSpacingLessons >= SRS_MASTERED_MIN_SESSIONS_OFFSET
  ) {
    return Math.min(
      prev.srsSpacingLessons * 2,
      SRS_MASTERED_MAX_SESSIONS_OFFSET,
    );
  }
  return SRS_MASTERED_MIN_SESSIONS_OFFSET;
}

/** Absolute lesson index when the phrase becomes SRS-due. */
export function scheduleDueOnLessonSessionIndex(
  completedLessonCount: number,
  offset: number,
): number {
  return completedLessonCount + offset;
}

export function isDueForReview(
  progress: PhraseProgress,
  completedLessonCount: number,
): boolean {
  return progress.dueOnLessonSessionIndex <= completedLessonCount;
}
