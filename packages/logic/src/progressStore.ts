import type { PhraseProgress } from './types';

export interface ProgressStore {
  get(phraseId: string): PhraseProgress | null;
  put(progress: PhraseProgress): void;
  all(): PhraseProgress[];
  /**
   * Remove all entries. Useful in tests; app runtime rarely needs this.
   */
  clear(): void;
}

/**
 * Simple in-memory store. The interface is deliberately tiny so we can later
 * drop in localStorage / AsyncStorage / server-backed implementations without
 * touching the engine code.
 */
export function createInMemoryProgressStore(): ProgressStore {
  const data = new Map<string, PhraseProgress>();
  return {
    get(phraseId) {
      return data.get(phraseId) ?? null;
    },
    put(progress) {
      data.set(progress.phraseId, progress);
    },
    all() {
      return [...data.values()];
    },
    clear() {
      data.clear();
    },
  };
}
