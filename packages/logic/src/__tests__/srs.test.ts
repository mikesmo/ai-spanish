import { describe, expect, it } from 'vitest';
import {
  SRS_LEARNING_INTERVAL_MS,
  SRS_MASTERED_MAX_INTERVAL_MS,
  SRS_MASTERED_MIN_INTERVAL_MS,
  SRS_STABILIZING_INTERVAL_MS,
  isDueForReview,
  scheduleNextReview,
} from '../srs';
import type { PhraseProgress } from '../types';

const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const progress = (overrides: Partial<PhraseProgress> = {}): PhraseProgress => ({
  phraseId: 'p1',
  masteryScore: 0.5,
  stabilityScore: 0.3,
  state: 'learning',
  lastSeenAt: NOW,
  nextReviewAt: NOW + ONE_DAY_MS,
  ...overrides,
});

describe('scheduleNextReview', () => {
  it('uses the learning interval when mastery < 0.6', () => {
    const next = progress({ masteryScore: 0.4 });
    expect(scheduleNextReview(null, next, NOW) - NOW).toBe(
      SRS_LEARNING_INTERVAL_MS,
    );
  });

  it('uses the stabilizing interval when 0.6 <= mastery < 0.8', () => {
    const next = progress({ masteryScore: 0.7 });
    expect(scheduleNextReview(null, next, NOW) - NOW).toBe(
      SRS_STABILIZING_INTERVAL_MS,
    );
  });

  it('starts at 7 days when first mastered', () => {
    const next = progress({ masteryScore: 0.9, state: 'mastered' });
    expect(scheduleNextReview(null, next, NOW) - NOW).toBe(
      SRS_MASTERED_MIN_INTERVAL_MS,
    );
  });

  it('doubles the interval on repeated mastery, capped at 14 days', () => {
    const prev: PhraseProgress = progress({
      masteryScore: 0.9,
      state: 'mastered',
      lastSeenAt: NOW - 7 * ONE_DAY_MS,
      nextReviewAt: NOW,
    });
    const next: PhraseProgress = progress({ masteryScore: 0.9, state: 'mastered' });
    const delta = scheduleNextReview(prev, next, NOW) - NOW;
    expect(delta).toBe(14 * ONE_DAY_MS);
  });

  it('does not exceed the max mastered interval', () => {
    const prev: PhraseProgress = progress({
      masteryScore: 0.95,
      state: 'mastered',
      lastSeenAt: NOW - 30 * ONE_DAY_MS,
      nextReviewAt: NOW,
    });
    const next: PhraseProgress = progress({ masteryScore: 0.95, state: 'mastered' });
    const delta = scheduleNextReview(prev, next, NOW) - NOW;
    expect(delta).toBeLessThanOrEqual(SRS_MASTERED_MAX_INTERVAL_MS);
  });
});

describe('isDueForReview', () => {
  it('is true when nextReviewAt is in the past', () => {
    expect(isDueForReview(progress({ nextReviewAt: NOW - 1 }), NOW)).toBe(true);
  });
  it('is true when nextReviewAt equals now', () => {
    expect(isDueForReview(progress({ nextReviewAt: NOW }), NOW)).toBe(true);
  });
  it('is false when nextReviewAt is in the future', () => {
    expect(isDueForReview(progress({ nextReviewAt: NOW + 1 }), NOW)).toBe(false);
  });
});
