import { MASTERY_LEARNING_CEIL, MASTERY_STABILIZING_CEIL, reduceProgress } from './mastery';
import type { PhraseEvent } from './events';
import type { Phrase } from './types';
import type { ProgressStore } from './progressStore';

/** Cap on how many times a single phrase can be requeued within a session. */
export const MAX_REINSERTS_PER_PHRASE_PER_SESSION = 2;
/** Positional offset (from the head of the remaining queue) for mastery < 0.6 and reveal. */
export const REPEAT_SOON_SLOTS = 2;
/** Positional offset for 0.6 <= mastery < 0.8. */
export const REPEAT_LATER_SLOTS = 5;

export interface SessionEngine {
  /** Returns the next phrase to present, or null when the session is complete. */
  pickNext(): Phrase | null;
  /** Consume an event, updating progress and reordering the queue. */
  onEvent(event: PhraseEvent): void;
  /** Phrases left in the session (including any reinsertions). */
  remaining(): number;
}

function insertAt<T>(arr: T[], index: number, item: T): T[] {
  const clamped = Math.min(Math.max(index, 0), arr.length);
  return [...arr.slice(0, clamped), item, ...arr.slice(clamped)];
}

/**
 * In-session Pimsleur-style loop. The queue is a simple list of remaining
 * phrases. After each attempt, the just-presented phrase may be reinserted K
 * positions ahead in the queue (positional, not tick-based).
 */
export function createSessionEngine(
  deck: Phrase[],
  store: ProgressStore,
): SessionEngine {
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

    onEvent(event) {
      if (event.eventType === 'practice') {
        // Spec rule: practice never updates PhraseProgress and never reorders.
        return;
      }

      const prev = store.get(event.phraseId);
      const next = reduceProgress(prev, event);
      store.put(next);

      if (event.phraseId !== currentPhraseId) return;
      const phrase = deckById.get(event.phraseId);
      if (!phrase) return;

      switch (event.eventType) {
        case 'attempt': {
          if (next.masteryScore < MASTERY_LEARNING_CEIL) {
            reinsert(phrase, REPEAT_SOON_SLOTS);
          } else if (next.masteryScore < MASTERY_STABILIZING_CEIL) {
            reinsert(phrase, REPEAT_LATER_SLOTS);
          }
          // mastery >= 0.8 → drop (do nothing).
          break;
        }
        case 'reveal': {
          reinsert(phrase, REPEAT_SOON_SLOTS);
          break;
        }
      }
    },

    remaining() {
      return queue.length;
    },
  };
}
