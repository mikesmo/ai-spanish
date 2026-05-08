import { buildDeckFingerprint } from './sessionEngine';
import type { SessionCheckpointParsed } from './schemas/sessionCheckpoint';
import type { Phrase } from './types';

export interface BuildDevPhraseIndexCheckpointArgs {
  lessonId: string;
  deck: Phrase[];
  /** 0-based transcript order; clamped to the deck bounds. */
  phraseIndex: number;
  completedLessonCount: number;
}

/**
 * Synthetic session checkpoint starting at phrase `deck[phraseIndex]`, with the
 * remaining transcript order queued. Intentionally thin — use only from dev tooling
 * (e.g. a `?phraseIndex=` query on web) alongside `NODE_ENV === 'development'`.
 */
export function buildDevPhraseIndexCheckpoint(
  args: BuildDevPhraseIndexCheckpointArgs,
): SessionCheckpointParsed {
  const { lessonId, deck, phraseIndex, completedLessonCount } = args;
  if (deck.length === 0) {
    throw new Error('buildDevPhraseIndexCheckpoint: deck must not be empty');
  }
  const clamped = Math.min(Math.max(0, phraseIndex), deck.length - 1);
  const currentPhrase = deck[clamped];
  const queuePhraseIds = deck.slice(clamped + 1).map((p) => p.name);
  return {
    schemaVersion: 1,
    lessonId,
    queuePhraseIds,
    currentPresentedPhraseId: currentPhrase.name,
    reinsertCount: {},
    progress: [],
    completedLessonCount,
    deckFingerprint: buildDeckFingerprint(deck),
    wordScores: {},
    grammarItemScores: {},
  };
}
