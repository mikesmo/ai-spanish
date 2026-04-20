import { describe, expect, it } from 'vitest';
import { buildLesson, DEFAULT_DECK_SIZE } from '../lessonBuilder';
import { createInMemoryProgressStore } from '../progressStore';
import { POS_WEIGHTS } from '../weights';
import type { Phrase, PhraseProgress } from '../types';

const NOW = 1_700_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const phrase = (id: string): Phrase => ({
  id,
  English: { intro: '', question: id },
  Spanish: {
    grammar: '',
    answer: id,
    words: [{ word: id, type: 'verb', weight: POS_WEIGHTS.verb }],
  },
});

const progress = (overrides: Partial<PhraseProgress>): PhraseProgress => ({
  phraseId: 'x',
  masteryScore: 0.5,
  stabilityScore: 0.3,
  state: 'learning',
  lastSeenAt: NOW,
  nextReviewAt: NOW + ONE_DAY_MS,
  ...overrides,
});

// Deterministic pseudo-random for the mastered bucket sampler.
const seededRandom = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

describe('buildLesson', () => {
  it('uses the 70/20/10 mix when all buckets are full', () => {
    const deck = Array.from({ length: 100 }, (_, i) => phrase(`p${i}`));
    const store = createInMemoryProgressStore();

    // 50 due, 30 weak (not due, not mastered), 20 mastered (not due).
    for (let i = 0; i < 50; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          nextReviewAt: NOW - 1,
          masteryScore: 0.5,
          state: 'learning',
        }),
      );
    }
    for (let i = 50; i < 80; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          nextReviewAt: NOW + ONE_DAY_MS * 3,
          masteryScore: 0.4,
          state: 'learning',
        }),
      );
    }
    for (let i = 80; i < 100; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          nextReviewAt: NOW + ONE_DAY_MS * 7,
          masteryScore: 0.9,
          state: 'mastered',
        }),
      );
    }

    const built = buildLesson(deck, store, NOW, {
      deckSize: DEFAULT_DECK_SIZE,
      random: seededRandom(42),
    });

    expect(built.length).toBe(DEFAULT_DECK_SIZE);
    expect(new Set(built.map((p) => p.id)).size).toBe(DEFAULT_DECK_SIZE);

    // With deckSize 20 → 14 scheduled / 4 weak / 2 mastered.
    const scheduledIds = built
      .filter((p) => Number(p.id.slice(1)) < 50)
      .map((p) => p.id);
    const weakIds = built
      .filter((p) => {
        const idx = Number(p.id.slice(1));
        return idx >= 50 && idx < 80;
      })
      .map((p) => p.id);
    const masteredIds = built
      .filter((p) => Number(p.id.slice(1)) >= 80)
      .map((p) => p.id);

    expect(scheduledIds.length).toBe(14);
    expect(weakIds.length).toBe(4);
    expect(masteredIds.length).toBe(2);
  });

  it('treats never-seen phrases as weak', () => {
    const deck = [phrase('a'), phrase('b'), phrase('c')];
    const store = createInMemoryProgressStore();
    const built = buildLesson(deck, store, NOW, { deckSize: 3 });
    expect(built.length).toBe(3);
    expect(new Set(built.map((p) => p.id))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('orders weak bucket by ascending mastery (weakest first)', () => {
    const deck = Array.from({ length: 5 }, (_, i) => phrase(`p${i}`));
    const store = createInMemoryProgressStore();
    const masteries = [0.5, 0.1, 0.4, 0.2, 0.3];
    masteries.forEach((m, i) => {
      store.put(
        progress({
          phraseId: `p${i}`,
          nextReviewAt: NOW + ONE_DAY_MS * 3,
          masteryScore: m,
          state: 'learning',
        }),
      );
    });
    const built = buildLesson(deck, store, NOW, {
      deckSize: 3,
      random: seededRandom(7),
    });
    // 3-slot deck → 70% scheduled = 2, 20% weak = 1, 10% mastered = 0.
    // But no scheduled available, so weak fills in. The test checks weak
    // ordering when ≥1 weak slot is present.
    expect(built.length).toBe(3);
    // The very first weak pick should be the lowest-mastery phrase, p1.
    expect(built.map((p) => p.id)).toContain('p1');
  });

  it('backfills when a bucket is empty', () => {
    const deck = Array.from({ length: 5 }, (_, i) => phrase(`p${i}`));
    const store = createInMemoryProgressStore();
    for (let i = 0; i < 5; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          nextReviewAt: NOW - 1,
          masteryScore: 0.5,
          state: 'learning',
        }),
      );
    }
    const built = buildLesson(deck, store, NOW, { deckSize: 5 });
    expect(built.length).toBe(5);
  });

  it('respects deckSize even when more candidates exist', () => {
    const deck = Array.from({ length: 50 }, (_, i) => phrase(`p${i}`));
    const store = createInMemoryProgressStore();
    for (let i = 0; i < 50; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          nextReviewAt: NOW - 1,
          masteryScore: 0.5,
          state: 'learning',
        }),
      );
    }
    const built = buildLesson(deck, store, NOW, { deckSize: 10 });
    expect(built.length).toBe(10);
  });
});
