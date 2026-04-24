import { MASTERY_STABILIZING_CEIL, reduceProgress } from './mastery';
import type { ReduceProgressContext } from './mastery';
import type { PhraseEvent } from './events';
import type { Phrase } from './types';
import type { ProgressStore } from './progressStore';

/** Cap on how many times a single phrase can be requeued within a session. */
export const MAX_REINSERTS_PER_PHRASE_PER_SESSION = 2;

/**
 * Continuous in-session requeue tunables.
 *
 * Slot depth (positions ahead of the current queue head) is a linear function
 * of a weighted blend of `masteryScore` and `stabilityScore`:
 *
 *   combined = REPEAT_MASTERY_WEIGHT * mastery + REPEAT_STABILITY_WEIGHT * stability
 *   t        = clamp01(combined / MASTERY_STABILIZING_CEIL)
 *   slots    = round(MIN_REPEAT_SLOTS + (MAX_REPEAT_SLOTS - MIN_REPEAT_SLOTS) * t)
 *
 * Weaker phrases (low mastery AND low stability) are reinserted closer to the
 * head — they come back sooner. Strong-but-not-mastered phrases get pushed
 * deeper. Once `masteryScore` crosses `MASTERY_STABILIZING_CEIL` the phrase
 * is dropped from the session entirely (mirrors `classifyState`).
 *
 * Weights must sum to 1 so the blend stays in `[0, 1]`.
 */
export const REPEAT_MASTERY_WEIGHT = 0.7;
export const REPEAT_STABILITY_WEIGHT = 0.3;
export const MIN_REPEAT_SLOTS = 2;
export const MAX_REPEAT_SLOTS = 8;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Returns the positional offset at which a just-presented phrase should be
 * reinserted into the remaining queue, or `null` when the phrase is mastered
 * (≥ `MASTERY_STABILIZING_CEIL`) and should drop out of the session.
 *
 * Pure — no engine state, no randomness — so it's safe to call from tests
 * or preview UIs.
 */
export function computeReinsertSlots(
  masteryScore: number,
  stabilityScore: number,
): number | null {
  if (masteryScore >= MASTERY_STABILIZING_CEIL) return null;
  const combined =
    REPEAT_MASTERY_WEIGHT * clamp01(masteryScore) +
    REPEAT_STABILITY_WEIGHT * clamp01(stabilityScore);
  const t = clamp01(combined / MASTERY_STABILIZING_CEIL);
  const slots =
    MIN_REPEAT_SLOTS + (MAX_REPEAT_SLOTS - MIN_REPEAT_SLOTS) * t;
  return Math.round(slots);
}

export interface SessionEngine {
  /** Returns the next phrase to present, or null when the session is complete. */
  pickNext(): Phrase | null;
  /** Consume an event, updating progress and reordering the queue. */
  onEvent(event: PhraseEvent): void;
  /** The id of the last phrase returned by `pickNext` (current card; not in `queue`). */
  getCurrentPresentedPhraseId(): string | null;
  /** Phrases left in the session (including any reinsertions). */
  remaining(): number;
  /**
   * 0-based index of `phraseId` in the **remaining** queue (the one `pickNext`
   * will shift from next). Returns `null` if the phrase is not in the queue
   * — e.g. it was dropped after a mastered attempt, hasn't been enqueued, or
   * is the currently-presented card (already shifted off the queue). Useful
   * for UI surfaces that want to show "this phrase will reappear in N cards".
   */
  getQueuePosition(phraseId: string): number | null;
}

function insertAt<T>(arr: T[], index: number, item: T): T[] {
  const clamped = Math.min(Math.max(index, 0), arr.length);
  return [...arr.slice(0, clamped), item, ...arr.slice(clamped)];
}

export interface CreateSessionEngineOptions {
  /**
   * Lessons fully completed *before* this lesson run. Drives session-based SRS
   * in `reduceProgress`. Defaults to always `0` when omitted.
   */
  getCompletedLessonCount?: () => number;
}

/**
 * In-session Pimsleur-style loop. The queue is a simple list of remaining
 * phrases. After each attempt, the just-presented phrase may be reinserted K
 * positions ahead in the queue (positional, not tick-based).
 */
export function createSessionEngine(
  deck: Phrase[],
  store: ProgressStore,
  options: CreateSessionEngineOptions = {},
): SessionEngine {
  const getCompletedLessonCount =
    options.getCompletedLessonCount ?? (() => 0);
  let queue: Phrase[] = [...deck];
  let currentPhraseId: string | null = null;
  const reinsertCount = new Map<string, number>();
  const deckById = new Map(deck.map((p) => [p.id, p]));

  const reinsert = (phrase: Phrase, slotsAhead: number) => {
    const used = reinsertCount.get(phrase.id) ?? 0;
    if (used >= MAX_REINSERTS_PER_PHRASE_PER_SESSION) return;
    reinsertCount.set(phrase.id, used + 1);
    queue = insertAt(queue, slotsAhead, phrase);
  };

  return {
    pickNext() {
      const next = queue.shift() ?? null;
      currentPhraseId = next?.id ?? null;
      return next;
    },

    getCurrentPresentedPhraseId() {
      return currentPhraseId;
    },

    onEvent(event) {
      if (event.eventType === 'practice') {
        // Spec rule: practice never updates PhraseProgress and never reorders.
        return;
      }

      const prev = store.get(event.phraseId);
      const reduceCtx: ReduceProgressContext = {
        completedLessonCount: getCompletedLessonCount(),
      };
      const next = reduceProgress(prev, event, reduceCtx);
      store.put(next);

      if (event.phraseId !== currentPhraseId) return;
      const phrase = deckById.get(event.phraseId);
      if (!phrase) return;

      // Both 'attempt' and 'reveal' paths drive requeue through the same
      // continuous formula. Reveal-specific decays already live in
      // `reduceProgress` (mastery × 0.6, stability × 0.7), so by the time we
      // reach here `next` already carries the penalty and the formula
      // naturally maps a just-revealed phrase to a near-head slot.
      const slots = computeReinsertSlots(
        next.masteryScore,
        next.stabilityScore,
      );
      if (slots !== null) reinsert(phrase, slots);
    },

    remaining() {
      return queue.length;
    },

    getQueuePosition(phraseId) {
      const idx = queue.findIndex((p) => p.id === phraseId);
      return idx === -1 ? null : idx;
    },
  };
}
