import { describe, expect, it } from 'vitest';
import { createInMemoryProgressStore } from '../progressStore';
import type { PhraseProgress } from '../types';

const progress = (overrides: Partial<PhraseProgress> = {}): PhraseProgress => ({
  phraseId: 'p1',
  masteryScore: 0.5,
  stabilityScore: 0.3,
  state: 'learning',
  lastSeenAt: 0,
  dueOnLessonSessionIndex: 0,
  srsSpacingLessons: 1,
  ...overrides,
});

describe('createInMemoryProgressStore', () => {
  it('returns null for unknown ids', () => {
    const store = createInMemoryProgressStore();
    expect(store.get('nope')).toBeNull();
  });

  it('stores and retrieves by phraseId', () => {
    const store = createInMemoryProgressStore();
    const p = progress();
    store.put(p);
    expect(store.get('p1')).toEqual(p);
  });

  it('overwrites on repeated put', () => {
    const store = createInMemoryProgressStore();
    store.put(progress({ masteryScore: 0.1 }));
    store.put(progress({ masteryScore: 0.9 }));
    expect(store.get('p1')?.masteryScore).toBe(0.9);
  });

  it('lists all entries', () => {
    const store = createInMemoryProgressStore();
    store.put(progress({ phraseId: 'a' }));
    store.put(progress({ phraseId: 'b' }));
    expect(store.all().map((p) => p.phraseId).sort()).toEqual(['a', 'b']);
  });

  it('clear removes everything', () => {
    const store = createInMemoryProgressStore();
    store.put(progress({ phraseId: 'a' }));
    store.clear();
    expect(store.all()).toEqual([]);
  });
});
