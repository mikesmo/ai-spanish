import { describe, expect, it } from 'vitest';
import { buildLesson, DEFAULT_DECK_SIZE, LESSON_MIX_MASTERED, LESSON_MIX_WEAK } from '../lessonBuilder';
import { createInMemoryProgressStore } from '../progressStore';
import { POS_WEIGHTS } from '../weights';
import type { Phrase, PhraseProgress } from '../types';

const NOW = 1_700_000_000_000;

const phrase = (name: string, index = 0): Phrase => ({
  name,
  index,
  English: {
    'first-intro': '',
    'second-intro': '',
    question: name,
    'follow-up': '',
    explain: '',
  },
  Spanish: {
    grammar: '',
    answer: name,
    words: [{ word: name, type: 'verb', weight: POS_WEIGHTS.verb }],
  },
});

const progress = (overrides: Partial<PhraseProgress>): PhraseProgress => ({
  phraseId: 'x',
  masteryScore: 0.5,
  stabilityScore: 0.3,
  state: 'learning',
  lastSeenAt: NOW,
  ...overrides,
});

const seededRandom = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

describe('buildLesson', () => {
  it('uses the 90/10 mix when both buckets are full', () => {
    const deck = Array.from({ length: 100 }, (_, i) => phrase(`p${i}`, i));
    const store = createInMemoryProgressStore();

    // p0-p79: weak (non-mastered)
    for (let i = 0; i < 80; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          masteryScore: 0.4,
          state: 'learning',
        }),
      );
    }
    // p80-p99: mastered
    for (let i = 80; i < 100; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          masteryScore: 0.9,
          state: 'mastered',
        }),
      );
    }

    const built = buildLesson(deck, store, {
      deckSize: DEFAULT_DECK_SIZE,
      random: seededRandom(42),
    });

    expect(built.length).toBe(DEFAULT_DECK_SIZE);
    expect(new Set(built.map((p) => p.name)).size).toBe(DEFAULT_DECK_SIZE);

    const weakCount = built.filter((p) => Number(p.name.slice(1)) < 80).length;
    const masteredCount = built.filter((p) => Number(p.name.slice(1)) >= 80).length;

    expect(weakCount).toBe(Math.round(DEFAULT_DECK_SIZE * LESSON_MIX_WEAK));
    expect(masteredCount).toBe(Math.round(DEFAULT_DECK_SIZE * LESSON_MIX_MASTERED));
  });

  it('treats never-seen phrases as weak', () => {
    const deck = [phrase('a'), phrase('b'), phrase('c')];
    const store = createInMemoryProgressStore();
    const built = buildLesson(deck, store, { deckSize: 3 });
    expect(built.length).toBe(3);
    expect(new Set(built.map((p) => p.name))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('orders weak bucket by ascending mastery (weakest first)', () => {
    const deck = Array.from({ length: 5 }, (_, i) => phrase(`p${i}`, i));
    const store = createInMemoryProgressStore();
    const masteries = [0.5, 0.1, 0.4, 0.2, 0.3];
    masteries.forEach((m, i) => {
      store.put(
        progress({
          phraseId: `p${i}`,
          masteryScore: m,
          state: 'learning',
        }),
      );
    });
    const built = buildLesson(deck, store, {
      deckSize: 3,
      random: seededRandom(7),
    });
    expect(built.length).toBe(3);
    // p1 has the lowest mastery (0.1) so it must appear
    expect(built.map((p) => p.name)).toContain('p1');
  });

  it('backfills when mastered bucket is empty', () => {
    const deck = Array.from({ length: 5 }, (_, i) => phrase(`p${i}`, i));
    const store = createInMemoryProgressStore();
    for (let i = 0; i < 5; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          masteryScore: 0.5,
          state: 'learning',
        }),
      );
    }
    const built = buildLesson(deck, store, { deckSize: 5 });
    expect(built.length).toBe(5);
  });

  it('respects deckSize even when more candidates exist', () => {
    const deck = Array.from({ length: 50 }, (_, i) => phrase(`p${i}`, i));
    const store = createInMemoryProgressStore();
    for (let i = 0; i < 50; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          masteryScore: 0.5,
          state: 'learning',
        }),
      );
    }
    const built = buildLesson(deck, store, { deckSize: 10 });
    expect(built.length).toBe(10);
  });
});
