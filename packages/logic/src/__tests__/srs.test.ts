import { describe, expect, it } from 'vitest';
import {
  SRS_LEARNING_SESSIONS_OFFSET,
  SRS_MASTERED_MAX_SESSIONS_OFFSET,
  SRS_MASTERED_MIN_SESSIONS_OFFSET,
  SRS_STABILIZING_SESSIONS_OFFSET,
  computeSrsLessonOffset,
  isDueForReview,
  scheduleDueOnLessonSessionIndex,
} from '../srs';
import type { PhraseProgress } from '../types';

const progress = (overrides: Partial<PhraseProgress> = {}): PhraseProgress => ({
  phraseId: 'p1',
  masteryScore: 0.5,
  stabilityScore: 0.3,
  state: 'learning',
  lastSeenAt: 0,
  dueOnLessonSessionIndex: 1,
  srsSpacingLessons: 1,
  ...overrides,
});

describe('computeSrsLessonOffset', () => {
  it('uses learning offset for learning state', () => {
    expect(computeSrsLessonOffset(null, 'learning')).toBe(
      SRS_LEARNING_SESSIONS_OFFSET,
    );
  });

  it('uses stabilizing offset for stabilizing state', () => {
    expect(computeSrsLessonOffset(null, 'stabilizing')).toBe(
      SRS_STABILIZING_SESSIONS_OFFSET,
    );
  });

  it('starts at min mastered offset when not previously mastered', () => {
    expect(computeSrsLessonOffset(progress(), 'mastered')).toBe(
      SRS_MASTERED_MIN_SESSIONS_OFFSET,
    );
  });

  it('doubles spacing when previously mastered, capped', () => {
    const prev = progress({
      state: 'mastered',
      srsSpacingLessons: SRS_MASTERED_MIN_SESSIONS_OFFSET,
    });
    expect(computeSrsLessonOffset(prev, 'mastered')).toBe(
      Math.min(
        SRS_MASTERED_MIN_SESSIONS_OFFSET * 2,
        SRS_MASTERED_MAX_SESSIONS_OFFSET,
      ),
    );
  });

  it('does not exceed max mastered spacing', () => {
    const prev = progress({
      state: 'mastered',
      srsSpacingLessons: SRS_MASTERED_MAX_SESSIONS_OFFSET,
    });
    expect(computeSrsLessonOffset(prev, 'mastered')).toBe(
      SRS_MASTERED_MAX_SESSIONS_OFFSET,
    );
  });
});

describe('scheduleDueOnLessonSessionIndex', () => {
  it('adds offset to completed lesson count', () => {
    expect(scheduleDueOnLessonSessionIndex(3, 2)).toBe(5);
  });
});

describe('isDueForReview', () => {
  it('is true when due index is at or before completed count', () => {
    expect(isDueForReview(progress({ dueOnLessonSessionIndex: 2 }), 3)).toBe(
      true,
    );
    expect(isDueForReview(progress({ dueOnLessonSessionIndex: 3 }), 3)).toBe(
      true,
    );
  });
  it('is false when due index is after completed count', () => {
    expect(isDueForReview(progress({ dueOnLessonSessionIndex: 4 }), 3)).toBe(
      false,
    );
  });
});
