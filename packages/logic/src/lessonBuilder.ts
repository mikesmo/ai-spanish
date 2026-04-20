import { isDueForReview } from './srs';
import type { Phrase, PhraseProgress } from './types';
import type { ProgressStore } from './progressStore';

/** Default daily lesson size. */
export const DEFAULT_DECK_SIZE = 20;

/** Composition of a daily deck. Must sum to 1. */
export const LESSON_MIX_SCHEDULED = 0.7;
export const LESSON_MIX_WEAK = 0.2;
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
 * Assemble a daily lesson deck using the spec's 70 / 20 / 10 mix:
 *
 *  - 70% scheduled reviews (phrases whose `nextReviewAt` is due).
 *  - 20% weakest non-scheduled (lowest mastery first).
 *  - 10% mastered reinforcement (sampled).
 *
 * If a bucket runs dry, remaining slots are filled from the other buckets.
 */
export function buildLesson(
  phrases: Phrase[],
  store: ProgressStore,
  now: number,
  options: LessonBuilderOptions = {},
): Phrase[] {
  const deckSize = options.deckSize ?? DEFAULT_DECK_SIZE;
  const random = options.random ?? Math.random;

  const progressByPhrase = new Map<string, PhraseProgress>();
  for (const p of store.all()) progressByPhrase.set(p.phraseId, p);

  const scheduledPhrases: Phrase[] = [];
  const weakPhrases: Array<{ phrase: Phrase; mastery: number }> = [];
  const masteredPhrases: Phrase[] = [];

  for (const phrase of phrases) {
    const progress = progressByPhrase.get(phrase.id);
    if (!progress) {
      // Treat never-seen phrases as "weak" (lowest mastery).
      weakPhrases.push({ phrase, mastery: 0 });
      continue;
    }
    if (isDueForReview(progress, now)) {
      scheduledPhrases.push(phrase);
    } else if (progress.state === 'mastered') {
      masteredPhrases.push(phrase);
    } else {
      weakPhrases.push({ phrase, mastery: progress.masteryScore });
    }
  }

  const targetScheduled = Math.round(deckSize * LESSON_MIX_SCHEDULED);
  const targetWeak = Math.round(deckSize * LESSON_MIX_WEAK);
  const targetMastered = Math.max(
    0,
    deckSize - targetScheduled - targetWeak,
  );

  const scheduledPick = scheduledPhrases.slice(0, targetScheduled);
  const weakSorted = [...weakPhrases].sort((a, b) => a.mastery - b.mastery);
  const weakPick = weakSorted.slice(0, targetWeak).map((x) => x.phrase);
  const masteredPick = drawN(masteredPhrases, targetMastered, random);

  const chosen = new Set<string>([
    ...scheduledPick.map((p) => p.id),
    ...weakPick.map((p) => p.id),
    ...masteredPick.map((p) => p.id),
  ]);

  // Backfill remaining slots from any bucket, preserving priority order.
  const remaining = deckSize - chosen.size;
  if (remaining > 0) {
    const leftovers = [
      ...scheduledPhrases.slice(targetScheduled),
      ...weakSorted.slice(targetWeak).map((x) => x.phrase),
      ...drawN(
        masteredPhrases.filter((p) => !chosen.has(p.id)),
        remaining,
        random,
      ),
    ];
    for (const phrase of leftovers) {
      if (chosen.size - (chosen.has(phrase.id) ? 1 : 0) >= deckSize) break;
      if (!chosen.has(phrase.id)) {
        chosen.add(phrase.id);
      }
      if (chosen.size >= deckSize) break;
    }
  }

  const phraseById = new Map(phrases.map((p) => [p.id, p]));
  const ordered: Phrase[] = [];
  const appendIfChosen = (p: Phrase) => {
    if (chosen.has(p.id)) ordered.push(p);
  };
  scheduledPick.forEach(appendIfChosen);
  weakPick.forEach(appendIfChosen);
  masteredPick.forEach(appendIfChosen);
  // Any backfilled phrases that haven't been emitted yet.
  for (const id of chosen) {
    if (!ordered.some((p) => p.id === id)) {
      const p = phraseById.get(id);
      if (p) ordered.push(p);
    }
  }
  return ordered;
}
