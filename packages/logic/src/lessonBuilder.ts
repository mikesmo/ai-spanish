import type { Phrase, PhraseProgress } from './types';
import type { ProgressStore } from './progressStore';

/** Default daily lesson size. */
export const DEFAULT_DECK_SIZE = 20;

/**
 * Composition of a daily deck. Must sum to 1.
 *
 * TODO: A future iteration will draw from the per-student "to be revised" LIFO
 * list (phrases that hit the in-session requeue cap) as a third bucket, giving
 * them priority over generic weak phrases.
 */
export const LESSON_MIX_WEAK = 0.9;
export const LESSON_MIX_MASTERED = 0.1;

export interface LessonBuilderOptions {
  deckSize?: number;
  /** Deterministic sampler for mastered reinforcement. Defaults to Math.random. */
  random?: () => number;
}

/** Seeded Fisher-Yates draw of `n` elements from `arr`. */
function drawN<T>(arr: T[], n: number, random: () => number): T[] {
  if (n <= 0) return [];
  const pool = [...arr];
  const out: T[] = [];
  const limit = Math.min(n, pool.length);
  for (let i = 0; i < limit; i++) {
    const idx = Math.floor(random() * pool.length);
    out.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return out;
}

/**
 * Assemble a daily lesson deck using a 90 / 10 mix:
 *
 *  - 90% weakest phrases (lowest mastery first, never-seen phrases treated as mastery 0).
 *  - 10% mastered reinforcement (sampled randomly).
 *
 * If a bucket runs dry, remaining slots are filled from the other bucket.
 */
export function buildLesson(
  phrases: Phrase[],
  store: ProgressStore,
  options: LessonBuilderOptions = {},
): Phrase[] {
  const deckSize = options.deckSize ?? DEFAULT_DECK_SIZE;
  const random = options.random ?? Math.random;

  const progressByPhrase = new Map<string, PhraseProgress>();
  for (const p of store.all()) progressByPhrase.set(p.phraseId, p);

  const weakPhrases: Array<{ phrase: Phrase; mastery: number }> = [];
  const masteredPhrases: Phrase[] = [];

  for (const phrase of phrases) {
    const progress = progressByPhrase.get(phrase.name);
    if (!progress || progress.state !== 'mastered') {
      weakPhrases.push({ phrase, mastery: progress?.masteryScore ?? 0 });
    } else {
      masteredPhrases.push(phrase);
    }
  }

  const targetWeak = Math.round(deckSize * LESSON_MIX_WEAK);
  const targetMastered = Math.max(0, deckSize - targetWeak);

  const weakSorted = [...weakPhrases].sort((a, b) => a.mastery - b.mastery);
  const weakPick = weakSorted.slice(0, targetWeak).map((x) => x.phrase);
  const masteredPick = drawN(masteredPhrases, targetMastered, random);

  const chosen = new Set<string>([
    ...weakPick.map((p) => p.name),
    ...masteredPick.map((p) => p.name),
  ]);

  // Backfill remaining slots if a bucket ran dry.
  const remaining = deckSize - chosen.size;
  if (remaining > 0) {
    const leftovers = [
      ...weakSorted.slice(targetWeak).map((x) => x.phrase),
      ...drawN(
        masteredPhrases.filter((p) => !chosen.has(p.name)),
        remaining,
        random,
      ),
    ];
    for (const phrase of leftovers) {
      if (!chosen.has(phrase.name)) {
        chosen.add(phrase.name);
      }
      if (chosen.size >= deckSize) break;
    }
  }

  const phraseByName = new Map(phrases.map((p) => [p.name, p]));
  const ordered: Phrase[] = [];
  weakPick.forEach((p) => { if (chosen.has(p.name)) ordered.push(p); });
  masteredPick.forEach((p) => { if (chosen.has(p.name)) ordered.push(p); });
  // Any backfilled phrases that haven't been emitted yet.
  for (const id of chosen) {
    if (!ordered.some((p) => p.name === id)) {
      const p = phraseByName.get(id);
      if (p) ordered.push(p);
    }
  }
  return ordered;
}
