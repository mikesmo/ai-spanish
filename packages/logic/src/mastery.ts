import type { PhraseEvent } from './events';
import type { PhraseProgress, PhraseState } from './types';

/** Stability EMA coefficient. `S' = (1 - alpha) * prev + alpha * current`. */
export const STABILITY_EMA_ALPHA = 0.3;

/** Mastery band boundaries. */
export const MASTERY_LEARNING_CEIL = 0.6;
export const MASTERY_STABILIZING_CEIL = 0.8;

/** With-fluency weights — must sum to 1. */
export const MASTERY_W_ACCURACY = 0.5;
export const MASTERY_W_FLUENCY = 0.3;
export const MASTERY_W_STABILITY = 0.2;

/** No-fluency weights (hand-picked, NOT a renormalization). */
export const MASTERY_W_ACCURACY_NO_FLUENCY = 0.6;
export const MASTERY_W_STABILITY_NO_FLUENCY = 0.4;

/** Reveal decay multipliers. */
export const REVEAL_MASTERY_DECAY = 0.6;
export const REVEAL_STABILITY_DECAY = 0.7;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 2 * ONE_DAY_MS;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function classifyState(mastery: number): PhraseState {
  if (mastery < MASTERY_LEARNING_CEIL) return 'learning';
  if (mastery < MASTERY_STABILIZING_CEIL) return 'stabilizing';
  return 'mastered';
}

/**
 * Compute mastery from accuracy + optional fluency + stability. When fluency
 * is null (e.g. on platforms without word timestamps), uses hand-picked
 * no-fluency weights — not a renormalization.
 */
export function computeMastery(
  accuracy: number,
  fluency: number | null,
  stability: number,
): number {
  if (fluency == null) {
    return clamp01(
      MASTERY_W_ACCURACY_NO_FLUENCY * accuracy +
        MASTERY_W_STABILITY_NO_FLUENCY * stability,
    );
  }
  return clamp01(
    MASTERY_W_ACCURACY * accuracy +
      MASTERY_W_FLUENCY * fluency +
      MASTERY_W_STABILITY * stability,
  );
}

/**
 * Canonical SRS schedule.
 */
export function scheduleNextReview(mastery: number, now: number): number {
  if (mastery < MASTERY_LEARNING_CEIL) return now + ONE_DAY_MS;
  if (mastery < MASTERY_STABILIZING_CEIL) return now + TWO_DAYS_MS;
  return now + SEVEN_DAYS_MS;
}

function newProgress(phraseId: string, now: number): PhraseProgress {
  return {
    phraseId,
    masteryScore: 0,
    stabilityScore: 0,
    state: 'new',
    lastSeenAt: now,
    nextReviewAt: now,
  };
}

/**
 * Pure reducer. Produces a new PhraseProgress from the previous one and an
 * event. `prev` may be null for a first-time event (the reducer seeds from 0).
 */
export function reduceProgress(
  prev: PhraseProgress | null,
  event: PhraseEvent,
): PhraseProgress {
  const base = prev ?? newProgress(event.phraseId, event.timestamp);

  switch (event.eventType) {
    case 'attempt': {
      const stabilityScore = clamp01(
        (1 - STABILITY_EMA_ALPHA) * base.stabilityScore +
          STABILITY_EMA_ALPHA * (event.isAccuracySuccess ? 1 : 0),
      );
      const masteryScore = computeMastery(
        event.accuracyScore,
        event.fluencyScore,
        stabilityScore,
      );
      return {
        phraseId: event.phraseId,
        masteryScore,
        stabilityScore,
        state: classifyState(masteryScore),
        lastSeenAt: event.timestamp,
        nextReviewAt: scheduleNextReview(masteryScore, event.timestamp),
      };
    }

    case 'practice': {
      // Spec rule: practice never touches progress. We intentionally do not
      // update lastSeenAt or any other field.
      return base;
    }

    case 'reveal': {
      const masteryScore = clamp01(base.masteryScore * REVEAL_MASTERY_DECAY);
      const stabilityScore = clamp01(
        base.stabilityScore * REVEAL_STABILITY_DECAY,
      );
      return {
        phraseId: event.phraseId,
        masteryScore,
        stabilityScore,
        state: 'learning',
        lastSeenAt: event.timestamp,
        // "review next lesson" — scheduled for tomorrow at the earliest.
        nextReviewAt: event.timestamp + ONE_DAY_MS,
      };
    }
  }
}
