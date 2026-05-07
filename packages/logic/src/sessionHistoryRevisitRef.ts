/**
 * Minimal slice of `HistoryEntry` for revisit-ref derivation (web sidebar `#`).
 */
export interface RevisitRefHistorySlice {
  id: string;
  phrase: { name: string };
  isRepeatedPresentation: boolean;
  eventSeq?: number;
}

/**
 * For each revisit row (`isRepeatedPresentation`), the displayed `#` of the **last**
 * row from the **immediately preceding** contiguous stint for this phrase — same rule as
 * the log `#` column: `eventSeq ?? (1-based chronological index)`.
 *
 * Walks backward past the current same-phrase block (attempt + Try Again), past other
 * phrases, then picks the **last** row of the nearest prior same-phrase block. Earlier logic
 * that stopped at the first `!isRepeatedPresentation` row incorrectly skipped intermediate
 * revisit blocks (those rows are also repeated).
 */
export const buildRevisitRefDisplayByEntryId = (
  history: readonly RevisitRefHistorySlice[],
): Map<string, number> => {
  const m = new Map<string, number>();

  const displaySeqAtIndex = (chronIdx: number): number => {
    const row = history[chronIdx];
    return row.eventSeq ?? chronIdx + 1;
  };

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (!entry.isRepeatedPresentation) continue;

    const pid = entry.phrase.name;

    let j = i - 1;
    while (j >= 0 && history[j].phrase.name === pid) {
      j--;
    }

    let ref = j;
    while (ref >= 0 && history[ref].phrase.name !== pid) {
      ref--;
    }

    if (ref >= 0) {
      m.set(entry.id, displaySeqAtIndex(ref));
    }
  }

  return m;
};
