import { describe, expect, it } from 'vitest';
import {
  MAX_REINSERTS_PER_PHRASE_PER_SESSION,
  REPEAT_LATER_SLOTS,
  REPEAT_SOON_SLOTS,
  createSessionEngine,
} from '../sessionEngine';
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

  it('reinserts weak phrases (< 0.6) REPEAT_SOON_SLOTS ahead', () => {
    const deck = [phrase('weak'), phrase('b'), phrase('c'), phrase('d')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext(); // weak
    engine.onEvent(
      attempt('weak', {
        accuracyScore: 0.2,
        fluencyScore: 0.2,
        isAccuracySuccess: false,
      }),
    );
    // Queue was [b, c, d]. Tick=1 after picking weak. Reinsert at tick+2 = 3.
    // So sequence should be b (tick 2), c (tick 3), weak (tick 4), d (tick 5).
    expect(engine.pickNext()?.id).toBe('b');
    expect(engine.pickNext()?.id).toBe('c');
    expect(engine.pickNext()?.id).toBe('weak');
    expect(engine.pickNext()?.id).toBe('d');
  });

  it('reinserts stabilizing phrases (0.6-0.8) REPEAT_LATER_SLOTS ahead', () => {
    const deck = Array.from({ length: 7 }, (_, i) => phrase(`p${i}`));
    const store = createInMemoryProgressStore();
    const engine = createSessionEngine(deck, store);
    engine.pickNext(); // p0
    // Craft an attempt whose mastery lands in [0.6, 0.8): accuracy 0.7,
    // fluency 0.7, stability 0.3 → 0.5*0.7 + 0.3*0.7 + 0.2*0.3 = 0.62.
    engine.onEvent(
      attempt('p0', {
        accuracyScore: 0.7,
        fluencyScore: 0.7,
      }),
    );
    const sequence: string[] = [];
    let next = engine.pickNext();
    while (next) {
      sequence.push(next.id);
      next = engine.pickNext();
    }
    // p0 should be ~5 slots later, not sooner.
    const p0Index = sequence.indexOf('p0');
    expect(p0Index).toBe(REPEAT_LATER_SLOTS);
  });

  it('reveals requeue at REPEAT_SOON_SLOTS and consume a reinsert slot', () => {
    const deck = [phrase('a'), phrase('b'), phrase('c'), phrase('d')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext(); // a
    engine.onEvent(reveal('a'));
    // Expect: b, c, a, d
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
  it('REPEAT_SOON_SLOTS < REPEAT_LATER_SLOTS', () => {
    expect(REPEAT_SOON_SLOTS).toBeLessThan(REPEAT_LATER_SLOTS);
  });
  it('cap is a positive integer', () => {
    expect(MAX_REINSERTS_PER_PHRASE_PER_SESSION).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_REINSERTS_PER_PHRASE_PER_SESSION)).toBe(true);
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

  it('returns REPEAT_SOON_SLOTS after a weak attempt reinserts the phrase', () => {
    const deck = [phrase('weak'), phrase('b'), phrase('c'), phrase('d')];
    const engine = createSessionEngine(deck, createInMemoryProgressStore());
    engine.pickNext();
    engine.onEvent(
      attempt('weak', {
        accuracyScore: 0.2,
        fluencyScore: 0.2,
        isAccuracySuccess: false,
      }),
    );
    expect(engine.getQueuePosition('weak')).toBe(REPEAT_SOON_SLOTS);
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
