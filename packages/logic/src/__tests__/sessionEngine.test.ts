import { describe, expect, it } from 'vitest';
import {
  MAX_REINSERTS_PER_PHRASE_PER_SESSION,
  MAX_REPEAT_SLOTS,
  MIN_REPEAT_SLOTS,
  REPEAT_MASTERY_WEIGHT,
  REPEAT_STABILITY_WEIGHT,
  computeReinsertSlots,
  createSessionEngine,
} from '../sessionEngine';
import { MASTERY_STABILIZING_CEIL, reduceProgress } from '../mastery';
import { createInMemoryProgressStore } from '../progressStore';
import { POS_WEIGHTS } from '../weights';
import type { Attempt, PracticeAttempt, RevealEvent } from '../events';
import type { Phrase } from '../types';

const NOW = 1_700_000_000_000;

const phrase = (id: string): Phrase => ({
  id,
  English: { intro: '', question: id },
  Spanish: {
    grammar: '',
    answer: id,
    words: [{ word: id, type: 'verb', weight: POS_WEIGHTS.verb }],
  },
});

const attempt = (phraseId: string, overrides: Partial<Attempt> = {}): Attempt => ({
  eventType: 'attempt',
  phraseId,
  transcript: [],
  missingWords: [],
  extraWords: [],
  accuracyScore: 1,
  fluencyScore: 1,
  isAccuracySuccess: true,
  success: true,
  timestamp: NOW,
  ...overrides,
});

const reveal = (phraseId: string): RevealEvent => ({
  eventType: 'reveal',
  phraseId,
  penaltyApplied: true,
  timestamp: NOW,
});

describe('createSessionEngine', () => {
  it('returns phrases in deck order by default', () => {
    const deck = [phrase('a'), phrase('b'), phrase('c')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    expect(engine.pickNext()?.id).toBe('a');
    expect(engine.pickNext()?.id).toBe('b');
    expect(engine.pickNext()?.id).toBe('c');
    expect(engine.pickNext()).toBeNull();
  });

  it('drops mastered phrases (>= 0.8) from the session', () => {
    const deck = [phrase('a'), phrase('b')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext(); // a
    engine.onEvent(attempt('a')); // high mastery → drop
    expect(engine.pickNext()?.id).toBe('b');
    expect(engine.pickNext()).toBeNull();
  });

  it('reinserts weak phrases at the formula-derived slot', () => {
    const deck = [
      phrase('weak'),
      phrase('b'),
      phrase('c'),
      phrase('d'),
      phrase('e'),
    ];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext(); // weak
    const weakAttempt: Attempt = attempt('weak', {
      accuracyScore: 0.2,
      fluencyScore: 0.2,
      isAccuracySuccess: false,
    });
    engine.onEvent(weakAttempt);
    // Derive the expected slot from the public formula rather than hard-coding
    // it — keeps the test sensitive to *behavior* (weak → low slot) while
    // tracking tuning changes in a single place.
    const nextProgress = reduceProgress(null, weakAttempt);
    const expectedSlot = computeReinsertSlots(
      nextProgress.masteryScore,
      nextProgress.stabilityScore,
    );
    expect(expectedSlot).not.toBeNull();
    expect(engine.getQueuePosition('weak')).toBe(expectedSlot);
  });

  it('reinserts stabilizing phrases deeper than weak ones', () => {
    const deck = Array.from({ length: 10 }, (_, i) => phrase(`p${i}`));
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext(); // p0
    // Craft an attempt whose mastery lands in the stabilizing band:
    // accuracy 0.7, fluency 0.7, success → stability EMA → 0.3, mastery ≈ 0.62.
    const stabilizingAttempt: Attempt = attempt('p0', {
      accuracyScore: 0.7,
      fluencyScore: 0.7,
    });
    engine.onEvent(stabilizingAttempt);
    const nextProgress = reduceProgress(null, stabilizingAttempt);
    const expectedSlot = computeReinsertSlots(
      nextProgress.masteryScore,
      nextProgress.stabilityScore,
    );
    expect(expectedSlot).not.toBeNull();
    // Sanity: a stabilizing phrase must land deeper than a fresh weak miss.
    const weakProgress = reduceProgress(
      null,
      attempt('x', {
        accuracyScore: 0.2,
        fluencyScore: 0.2,
        isAccuracySuccess: false,
      }),
    );
    const weakSlot = computeReinsertSlots(
      weakProgress.masteryScore,
      weakProgress.stabilityScore,
    );
    expect(expectedSlot).toBeGreaterThan(weakSlot!);
    expect(engine.getQueuePosition('p0')).toBe(expectedSlot);
  });

  it('reveals requeue near the front because their progress is decayed', () => {
    const deck = [phrase('a'), phrase('b'), phrase('c'), phrase('d')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext(); // a
    engine.onEvent(reveal('a'));
    // A fresh phrase revealed (prev mastery/stability = 0) stays at 0 post
    // decay, so the formula yields MIN_REPEAT_SLOTS = 2 — expect b, c, a, d.
    expect(engine.pickNext()?.id).toBe('b');
    expect(engine.pickNext()?.id).toBe('c');
    expect(engine.pickNext()?.id).toBe('a');
    expect(engine.pickNext()?.id).toBe('d');
  });

  it('caps reinserts per phrase at MAX_REINSERTS_PER_PHRASE_PER_SESSION', () => {
    const deck = [phrase('stuck'), ...Array.from({ length: 20 }, (_, i) => phrase(`p${i}`))];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    let reinsertions = 0;
    // Repeatedly pick and fail 'stuck'.
    for (let i = 0; i < 10; i++) {
      const next = engine.pickNext();
      if (next?.id === 'stuck') {
        if (i > 0) reinsertions++;
        engine.onEvent(
          attempt('stuck', {
            accuracyScore: 0.2,
            fluencyScore: 0.2,
            isAccuracySuccess: false,
            timestamp: NOW + i,
          }),
        );
      } else if (next) {
        engine.onEvent(attempt(next.id, { timestamp: NOW + i }));
      } else {
        break;
      }
    }
    // The initial presentation + at most MAX_REINSERTS.
    expect(reinsertions).toBeLessThanOrEqual(
      MAX_REINSERTS_PER_PHRASE_PER_SESSION,
    );
  });

  it('practice events do not reorder the queue or count against the cap', () => {
    const deck = [phrase('a'), phrase('b')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext(); // a
    const practice: PracticeAttempt = {
      eventType: 'practice',
      phraseId: 'a',
      transcript: [],
      fluencyScore: 1,
      timestamp: NOW,
    };
    engine.onEvent(practice);
    expect(engine.pickNext()?.id).toBe('b');
    expect(engine.pickNext()).toBeNull();
  });

  it('practice events do not update progress', () => {
    const deck = [phrase('a')];
    const store = createInMemoryProgressStore();
    const engine = createSessionEngine(deck, store);
    engine.pickNext();
    engine.onEvent({
      eventType: 'practice',
      phraseId: 'a',
      transcript: [],
      fluencyScore: 1,
      timestamp: NOW,
    });
    expect(store.get('a')).toBeNull();
  });

  it('advances tick when only future slots remain', () => {
    const deck = [phrase('weak')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext(); // weak
    engine.onEvent(
      attempt('weak', {
        accuracyScore: 0.2,
        fluencyScore: 0.2,
        isAccuracySuccess: false,
      }),
    );
    // Queue has one slot at tick+2. pickNext must advance tick and return it.
    expect(engine.pickNext()?.id).toBe('weak');
  });
});

describe('sessionEngine tunables', () => {
  it('MIN_REPEAT_SLOTS < MAX_REPEAT_SLOTS', () => {
    expect(MIN_REPEAT_SLOTS).toBeLessThan(MAX_REPEAT_SLOTS);
  });
  it('requeue blend weights sum to 1', () => {
    expect(REPEAT_MASTERY_WEIGHT + REPEAT_STABILITY_WEIGHT).toBeCloseTo(1, 10);
  });
  it('cap is a positive integer', () => {
    expect(MAX_REINSERTS_PER_PHRASE_PER_SESSION).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_REINSERTS_PER_PHRASE_PER_SESSION)).toBe(true);
  });
});

describe('computeReinsertSlots', () => {
  it('returns null (drop) when mastery reaches the stabilizing ceiling', () => {
    expect(computeReinsertSlots(MASTERY_STABILIZING_CEIL, 0)).toBeNull();
    expect(computeReinsertSlots(MASTERY_STABILIZING_CEIL, 1)).toBeNull();
    expect(computeReinsertSlots(1, 1)).toBeNull();
  });

  it('returns MIN_REPEAT_SLOTS for a full-bomb (mastery 0, stability 0)', () => {
    expect(computeReinsertSlots(0, 0)).toBe(MIN_REPEAT_SLOTS);
  });

  it('returns ≈ MAX_REPEAT_SLOTS just below the drop threshold', () => {
    // combined = 0.7 * 0.79 + 0.3 * 1 = 0.853, clamped t = 1 → slots = MAX.
    expect(computeReinsertSlots(0.79, 1)).toBe(MAX_REPEAT_SLOTS);
  });

  it('is monotonic non-decreasing in mastery (holding stability fixed)', () => {
    const slotsAt = (m: number): number =>
      computeReinsertSlots(m, 0.2) ?? MAX_REPEAT_SLOTS + 1;
    let prev = -Infinity;
    for (let m = 0; m < MASTERY_STABILIZING_CEIL; m += 0.02) {
      const s = slotsAt(m);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('stability shifts the slot deeper when mastery is tied', () => {
    const lowStab = computeReinsertSlots(0.5, 0.0);
    const highStab = computeReinsertSlots(0.5, 0.8);
    expect(lowStab).not.toBeNull();
    expect(highStab).not.toBeNull();
    expect(highStab!).toBeGreaterThan(lowStab!);
  });

  it('stays within [MIN_REPEAT_SLOTS, MAX_REPEAT_SLOTS] for all valid inputs', () => {
    for (let m = 0; m < MASTERY_STABILIZING_CEIL; m += 0.1) {
      for (let s = 0; s <= 1; s += 0.1) {
        const slots = computeReinsertSlots(m, s);
        expect(slots).not.toBeNull();
        expect(slots!).toBeGreaterThanOrEqual(MIN_REPEAT_SLOTS);
        expect(slots!).toBeLessThanOrEqual(MAX_REPEAT_SLOTS);
      }
    }
  });
});

describe('getQueuePosition', () => {
  it('returns the index of a phrase still in the remaining queue', () => {
    const deck = [phrase('a'), phrase('b'), phrase('c')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    expect(engine.getQueuePosition('a')).toBe(0);
    expect(engine.getQueuePosition('b')).toBe(1);
    expect(engine.getQueuePosition('c')).toBe(2);
  });

  it('returns null once a phrase has been picked (shifted off the queue)', () => {
    const deck = [phrase('a'), phrase('b')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext();
    expect(engine.getQueuePosition('a')).toBeNull();
    expect(engine.getQueuePosition('b')).toBe(0);
  });

  it('returns the formula-derived slot after a weak attempt reinserts the phrase', () => {
    const deck = [
      phrase('weak'),
      phrase('b'),
      phrase('c'),
      phrase('d'),
      phrase('e'),
    ];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext();
    const weakAttempt: Attempt = attempt('weak', {
      accuracyScore: 0.2,
      fluencyScore: 0.2,
      isAccuracySuccess: false,
    });
    engine.onEvent(weakAttempt);
    const nextProgress = reduceProgress(null, weakAttempt);
    const expectedSlot = computeReinsertSlots(
      nextProgress.masteryScore,
      nextProgress.stabilityScore,
    );
    expect(expectedSlot).not.toBeNull();
    expect(engine.getQueuePosition('weak')).toBe(expectedSlot);
  });

  it('returns null after a mastered attempt (phrase dropped)', () => {
    const deck = [phrase('a'), phrase('b')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext();
    engine.onEvent(attempt('a'));
    expect(engine.getQueuePosition('a')).toBeNull();
  });

  it('returns null for an unknown phrase id', () => {
    const deck = [phrase('a')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    expect(engine.getQueuePosition('nope')).toBeNull();
  });
});
