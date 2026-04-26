import { describe, expect, it } from 'vitest';
import { buildLesson, DEFAULT_DECK_SIZE } from '../lessonBuilder';
import { createInMemoryProgressStore } from '../progressStore';
import { POS_WEIGHTS } from '../weights';
import type { Phrase, PhraseProgress } from '../types';

const NOW = 1_700_000_000_000;

const phrase = (id: string, order = 0): Phrase => ({
  id,
  order,
  English: { 'first-intro': '', 'second-intro': '', question: id },
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
  dueOnLessonSessionIndex: 99,
  srsSpacingLessons: 1,
  ...overrides,
});

const seededRandom = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

/** Completed-lesson count for deck build: phrases with dueOn <= this are "due". */
const COMPLETED_LESSONS = 10;

describe('buildLesson', () => {
  it('uses the 70/20/10 mix when all buckets are full', () => {
    const deck = Array.from({ length: 100 }, (_, i) => phrase(`p${i}`, i));
    const store = createInMemoryProgressStore();

    for (let i = 0; i < 50; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          dueOnLessonSessionIndex: 5,
          masteryScore: 0.5,
          state: 'learning',
        }),
      );
    }
    for (let i = 50; i < 80; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          dueOnLessonSessionIndex: 20,
          masteryScore: 0.4,
          state: 'learning',
        }),
      );
    }
    for (let i = 80; i < 100; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          dueOnLessonSessionIndex: 50,
          masteryScore: 0.9,
          state: 'mastered',
        }),
      );
    }

    const built = buildLesson(deck, store, COMPLETED_LESSONS, {
      deckSize: DEFAULT_DECK_SIZE,
      random: seededRandom(42),
    });

    expect(built.length).toBe(DEFAULT_DECK_SIZE);
    expect(new Set(built.map((p) => p.id)).size).toBe(DEFAULT_DECK_SIZE);

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
    const built = buildLesson(deck, store, COMPLETED_LESSONS, { deckSize: 3 });
    expect(built.length).toBe(3);
    expect(new Set(built.map((p) => p.id))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('orders weak bucket by ascending mastery (weakest first)', () => {
    const deck = Array.from({ length: 5 }, (_, i) => phrase(`p${i}`, i));
    const store = createInMemoryProgressStore();
    const masteries = [0.5, 0.1, 0.4, 0.2, 0.3];
    masteries.forEach((m, i) => {
      store.put(
        progress({
          phraseId: `p${i}`,
          dueOnLessonSessionIndex: 20,
          masteryScore: m,
          state: 'learning',
        }),
      );
    });
    const built = buildLesson(deck, store, COMPLETED_LESSONS, {
      deckSize: 3,
      random: seededRandom(7),
    });
    expect(built.length).toBe(3);
    expect(built.map((p) => p.id)).toContain('p1');
  });

  it('backfills when a bucket is empty', () => {
    const deck = Array.from({ length: 5 }, (_, i) => phrase(`p${i}`, i));
    const store = createInMemoryProgressStore();
    for (let i = 0; i < 5; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          dueOnLessonSessionIndex: 3,
          masteryScore: 0.5,
          state: 'learning',
        }),
      );
    }
    const built = buildLesson(deck, store, COMPLETED_LESSONS, { deckSize: 5 });
    expect(built.length).toBe(5);
  });

  it('respects deckSize even when more candidates exist', () => {
    const deck = Array.from({ length: 50 }, (_, i) => phrase(`p${i}`, i));
    const store = createInMemoryProgressStore();
    for (let i = 0; i < 50; i++) {
      store.put(
        progress({
          phraseId: `p${i}`,
          dueOnLessonSessionIndex: 0,
          masteryScore: 0.5,
          state: 'learning',
        }),
      );
    }
    const built = buildLesson(deck, store, COMPLETED_LESSONS, { deckSize: 10 });
    expect(built.length).toBe(10);
  });
});
