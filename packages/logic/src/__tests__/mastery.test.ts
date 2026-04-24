import { describe, expect, it } from 'vitest';
import {
  MASTERY_LEARNING_CEIL,
  MASTERY_STABILIZING_CEIL,
  MASTERY_W_ACCURACY,
  MASTERY_W_ACCURACY_NO_FLUENCY,
  MASTERY_W_FLUENCY,
  MASTERY_W_STABILITY,
  MASTERY_W_STABILITY_NO_FLUENCY,
  REVEAL_MASTERY_DECAY,
  REVEAL_STABILITY_DECAY,
  STABILITY_EMA_ALPHA,
  classifyState,
  computeMastery,
  reduceProgress,
} from '../mastery';
import type { Attempt, PracticeAttempt, RevealEvent } from '../events';
import { SRS_MASTERED_MAX_SESSIONS_OFFSET } from '../srs';
import type { PhraseProgress } from '../types';
import type { ReduceProgressContext } from '../mastery';

const NOW = 1_700_000_000_000;
const CTX: ReduceProgressContext = { completedLessonCount: 0 };

const stubFluency = (fluencyScore: number) => ({
  speedScore: 1,
  pauseScore: 1,
  gapConsistencyScore: 1,
  fluencyScore,
  wordsPerSecond: 3,
  longPauses: 0,
});

const attempt = (overrides: Partial<Attempt> = {}): Attempt => {
  const accuracyScore = overrides.accuracyScore ?? 1;
  const fluencyScore =
    overrides.fluencyScore !== undefined ? overrides.fluencyScore : 1;
  const base: Attempt = {
    eventType: 'attempt',
    phraseId: 'p1',
    transcript: [],
    missingWords: [],
    extraWords: [],
    accuracyScore,
    fluencyScore,
    isAccuracySuccess: true,
    success: true,
    timestamp: NOW,
    accuracyBreakdown: {
      accuracy: accuracyScore,
      totalWeight: 1,
      missingPenalty: 0,
      extraPenalty: 0,
      rawExtraPenalty: 0,
    },
    fluencyBreakdown:
      fluencyScore == null ? null : stubFluency(fluencyScore),
  };
  const merged: Attempt = { ...base, ...overrides };
  if (!overrides.accuracyBreakdown) {
    merged.accuracyBreakdown = {
      accuracy: merged.accuracyScore,
      totalWeight: 1,
      missingPenalty: 0,
      extraPenalty: 0,
      rawExtraPenalty: 0,
    };
  }
  if (overrides.fluencyBreakdown === undefined) {
    merged.fluencyBreakdown =
      merged.fluencyScore == null ? null : stubFluency(merged.fluencyScore);
  }
  return merged;
};

describe('mastery weights', () => {
  it('with-fluency weights sum to 1', () => {
    expect(MASTERY_W_ACCURACY + MASTERY_W_FLUENCY + MASTERY_W_STABILITY).toBeCloseTo(
      1,
    );
  });

  it('no-fluency weights sum to 1', () => {
    expect(
      MASTERY_W_ACCURACY_NO_FLUENCY + MASTERY_W_STABILITY_NO_FLUENCY,
    ).toBeCloseTo(1);
  });
});

describe('computeMastery', () => {
  it('uses the with-fluency formula when fluency is present', () => {
    expect(computeMastery(1, 1, 1)).toBeCloseTo(1);
    expect(computeMastery(0.8, 0.6, 0.4)).toBeCloseTo(
      MASTERY_W_ACCURACY * 0.8 +
        MASTERY_W_FLUENCY * 0.6 +
        MASTERY_W_STABILITY * 0.4,
    );
  });

  it('uses the no-fluency formula when fluency is null', () => {
    expect(computeMastery(0.8, null, 0.4)).toBeCloseTo(
      MASTERY_W_ACCURACY_NO_FLUENCY * 0.8 +
        MASTERY_W_STABILITY_NO_FLUENCY * 0.4,
    );
  });

  it('is clamped to [0, 1]', () => {
    expect(computeMastery(2, 2, 2)).toBe(1);
    expect(computeMastery(-1, -1, -1)).toBe(0);
  });
});

describe('classifyState', () => {
  it('maps mastery bands to states', () => {
    expect(classifyState(0)).toBe('learning');
    expect(classifyState(MASTERY_LEARNING_CEIL - 0.001)).toBe('learning');
    expect(classifyState(MASTERY_LEARNING_CEIL)).toBe('stabilizing');
    expect(classifyState(MASTERY_STABILIZING_CEIL - 0.001)).toBe('stabilizing');
    expect(classifyState(MASTERY_STABILIZING_CEIL)).toBe('mastered');
    expect(classifyState(1)).toBe('mastered');
  });
});

describe('reduceProgress — attempt', () => {
  it('seeds progress from null on first attempt', () => {
    const result = reduceProgress(
      null,
      attempt({ accuracyScore: 0.5, fluencyScore: 0.5 }),
      CTX,
    );
    // S_0 = 0; S_1 = 0.7 * 0 + 0.3 * 1 = 0.3
    expect(result.stabilityScore).toBeCloseTo(STABILITY_EMA_ALPHA);
    expect(result.masteryScore).toBeGreaterThan(0);
    expect(result.lastSeenAt).toBe(NOW);
    expect(result.state).toBe('learning');
    expect(result.dueOnLessonSessionIndex).toBe(CTX.completedLessonCount + 1);
  });

  it('applies the EMA on successive successes', () => {
    const s1 = reduceProgress(null, attempt(), CTX);
    const s2 = reduceProgress(s1, attempt({ timestamp: NOW + 1000 }), CTX);
    // S1 = 0.3; S2 = 0.7*0.3 + 0.3*1 = 0.51
    expect(s2.stabilityScore).toBeCloseTo(0.51);
  });

  it('decays stability on a failed accuracy attempt', () => {
    const s1 = reduceProgress(null, attempt(), CTX);
    const s2 = reduceProgress(
      s1,
      attempt({
        isAccuracySuccess: false,
        accuracyScore: 0.3,
        timestamp: NOW + 1000,
      }),
      CTX,
    );
    // S = 0.7 * 0.3 + 0.3 * 0 = 0.21
    expect(s2.stabilityScore).toBeCloseTo(0.21);
    expect(s2.stabilityScore).toBeLessThan(s1.stabilityScore);
  });

  it('uses the no-fluency mastery formula when fluency is null', () => {
    const result = reduceProgress(
      null,
      attempt({ fluencyScore: null, accuracyScore: 1 }),
      CTX,
    );
    // S_1 = 0.3; mastery = 0.6*1 + 0.4*0.3 = 0.72
    expect(result.masteryScore).toBeCloseTo(0.72);
  });

  it('sets dueOnLessonSessionIndex per the SRS bands', () => {
    const low = reduceProgress(
      null,
      attempt({
        accuracyScore: 0.2,
        fluencyScore: 0.2,
        isAccuracySuccess: false,
      }),
      CTX,
    );
    expect(low.state).toBe('learning');
    expect(low.dueOnLessonSessionIndex).toBe(CTX.completedLessonCount + 1);
    expect(low.srsSpacingLessons).toBe(1);

    const mid = reduceProgress(
      null,
      attempt({ accuracyScore: 0.7, fluencyScore: 0.7 }),
      CTX,
    );
    expect(mid.state).toBe('stabilizing');
    expect(mid.dueOnLessonSessionIndex).toBe(CTX.completedLessonCount + 2);
    expect(mid.srsSpacingLessons).toBe(2);

    let p: PhraseProgress | null = null;
    for (let i = 0; i < 10; i++) {
      p = reduceProgress(p, attempt({ timestamp: NOW + i }), CTX);
    }
    expect(p!.state).toBe('mastered');
    // Repeated mastered attempts grow spacing geometrically (capped).
    expect(p!.srsSpacingLessons).toBe(SRS_MASTERED_MAX_SESSIONS_OFFSET);
    expect(p!.dueOnLessonSessionIndex).toBe(
      CTX.completedLessonCount + SRS_MASTERED_MAX_SESSIONS_OFFSET,
    );
  });
});

describe('reduceProgress — practice', () => {
  it('returns the previous progress unchanged', () => {
    const prev = reduceProgress(null, attempt(), CTX);
    const practice: PracticeAttempt = {
      eventType: 'practice',
      phraseId: 'p1',
      transcript: ['tengo'],
      fluencyScore: 1,
      timestamp: NOW + 5_000,
      accuracyBreakdown: {
        accuracy: 1,
        totalWeight: 1,
        missingPenalty: 0,
        extraPenalty: 0,
        rawExtraPenalty: 0,
      },
      fluencyBreakdown: stubFluency(1),
    };
    const next = reduceProgress(prev, practice, CTX);
    expect(next).toEqual(prev);
  });
});

describe('reduceProgress — reveal', () => {
  it('decays mastery and stability and forces learning state', () => {
    let p: PhraseProgress | null = null;
    for (let i = 0; i < 10; i++) {
      p = reduceProgress(p, attempt({ timestamp: NOW + i }), CTX);
    }
    const prev = p!;
    const reveal: RevealEvent = {
      eventType: 'reveal',
      phraseId: 'p1',
      penaltyApplied: true,
      timestamp: NOW + 100_000,
    };
    const next = reduceProgress(prev, reveal, CTX);
    expect(next.masteryScore).toBeCloseTo(prev.masteryScore * REVEAL_MASTERY_DECAY);
    expect(next.stabilityScore).toBeCloseTo(
      prev.stabilityScore * REVEAL_STABILITY_DECAY,
    );
    expect(next.state).toBe('learning');
    expect(next.dueOnLessonSessionIndex).toBe(CTX.completedLessonCount + 1);
  });

  it('is safe on a first-ever event', () => {
    const reveal: RevealEvent = {
      eventType: 'reveal',
      phraseId: 'p1',
      penaltyApplied: true,
      timestamp: NOW,
    };
    const result = reduceProgress(null, reveal, CTX);
    expect(result.masteryScore).toBe(0);
    expect(result.stabilityScore).toBe(0);
    expect(result.state).toBe('learning');
  });
});
