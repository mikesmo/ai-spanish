import type { Phrase } from './types';

/** Minimal slice of `HistoryEntry` for deriving per-presentation ordinals. */
export interface PresentationOrdinalHistorySlice {
  id: string;
  phrase: Pick<Phrase, 'name'>;
}

/**
 * Maps each history entry id to a 1-based presentation ordinal for that phrase
 * in chronological order. Contiguous rows with the same `phrase.name` share one
 * presentation (e.g. attempt + Try Again on the same card); when another phrase
 * appears between rows, the next block for a phrase increments its ordinal.
 */
export function buildPresentationOrdinalByEntryId(
  history: readonly PresentationOrdinalHistorySlice[],
): Map<string, number> {
  const ordinalByEntryId = new Map<string, number>();
  let prevPhraseId: string | null = null;
  const ordinalByPhraseId = new Map<string, number>();

  for (const entry of history) {
    const phraseId = entry.phrase.name;
    if (phraseId !== prevPhraseId) {
      const next = (ordinalByPhraseId.get(phraseId) ?? 0) + 1;
      ordinalByPhraseId.set(phraseId, next);
      prevPhraseId = phraseId;
    }
    ordinalByEntryId.set(entry.id, ordinalByPhraseId.get(phraseId)!);
  }

  return ordinalByEntryId;
}
