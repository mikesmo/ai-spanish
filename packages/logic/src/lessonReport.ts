import type { Attempt, PhraseEvent, PracticeAttempt, RevealEvent } from './events';
import { buildPresentationOrdinalByEntryId } from './sessionHistoryPresentationOrdinals';
import type { HistoryEntry } from './useSessionHistory';
import type { Phrase, PhraseProgress, PhraseState } from './types';
import type { PartOfSpeech } from './weights';
import { PART_OF_SPEECH_VALUES } from './weights';
import { normalizeStr } from './comparison';
import { classifyItemMastery, isUntrained } from './itemMastery';
import type { ItemScore, ItemMasteryBand } from './itemMastery';
import type { IncorrectPhraseRecord } from './incorrectPhraseTracker';

export interface LessonReportSummary {
  totalEvents: number;
  totalAttempts: number;
  exactCorrect: number;
  exactCorrectPct: number | null;
  avgAccuracy: number | null;
  avgFluency: number | null;
  practiceCount: number;
  revealCount: number;
  revisitAttemptCount: number;
}

/**
 * Pure aggregation of a completed lesson's history. Mirrors `computeStats` in
 * the web `SessionHistoryLogView` so the report page and the in-session stats
 * bar share one source of truth.
 */
export const computeLessonReportSummary = (
  entries: readonly HistoryEntry[],
): LessonReportSummary => {
  const attempts = entries.filter(
    (h): h is HistoryEntry & { event: Attempt } =>
      h.event.eventType === 'attempt',
  );
  const total = attempts.length;
  const exact = attempts.filter((h) => h.event.success).length;
  const accuracySum = attempts.reduce(
    (sum, h) => sum + h.event.accuracyScore,
    0,
  );
  const fluencyVals = attempts
    .map((h) => h.event.fluencyScore)
    .filter((v): v is number => v != null);
  return {
    totalEvents: entries.length,
    totalAttempts: total,
    exactCorrect: exact,
    exactCorrectPct: total > 0 ? exact / total : null,
    avgAccuracy: total > 0 ? accuracySum / total : null,
    avgFluency:
      fluencyVals.length > 0
        ? fluencyVals.reduce((s, v) => s + v, 0) / fluencyVals.length
        : null,
    practiceCount: entries.filter((h) => h.event.eventType === 'practice')
      .length,
    revealCount: entries.filter((h) => h.event.eventType === 'reveal').length,
    revisitAttemptCount: attempts.filter((h) => h.isRepeatedPresentation)
      .length,
  };
};

export interface PhraseRevisitRow {
  phrase: Phrase;
  /**
   * Number of times the phrase was re-presented after its first showing
   * (presentation ordinal − 1).
   */
  revisitCount: number;
  /** Count of failed scored attempts on the phrase across the lesson. */
  failedAttempts: number;
  /**
   * `#` column for this phrase’s last history row — `eventSeq` when set, else
   * 1-based chronological index (matches `SessionHistoryLogView`).
   */
  lastEventSeq: number;
}

/**
 * For each phrase (`phrase.name`), the displayed `#` for its chronologically last
 * row — same rule as the session log: `eventSeq ?? (1-based index in lesson order)`.
 */
export const lastHistoryDisplaySeqByPhrase = (
  entries: readonly HistoryEntry[],
): Map<string, number> => {
  const map = new Map<string, number>();
  entries.forEach((entry, idx) => {
    const seq = entry.eventSeq ?? idx + 1;
    map.set(entry.phrase.name, seq);
  });
  return map;
};

export interface PhraseFailedAttemptBuckets {
  once: PhraseRevisitRow[];
  twice: PhraseRevisitRow[];
  threePlus: PhraseRevisitRow[];
}

const isAttempt = (event: PhraseEvent): event is Attempt =>
  event.eventType === 'attempt';

/**
 * Buckets phrases by how many scored attempts failed accuracy (`!isAccuracySuccess`).
 * Phrases with zero failed attempts are omitted. Each row still includes `revisitCount`
 * for display (re-presentations after the first card).
 */
export const bucketPhrasesByFailedAttemptCount = (
  entries: readonly HistoryEntry[],
): PhraseFailedAttemptBuckets => {
  const lastEventSeqByPhrase = lastHistoryDisplaySeqByPhrase(entries);
  const ordinalByEntryId = buildPresentationOrdinalByEntryId(entries);

  const maxOrdinalByPhrase = new Map<string, number>();
  const phraseByName = new Map<string, Phrase>();
  const failedAttemptsByPhrase = new Map<string, number>();
  const firstSeenIndexByPhrase = new Map<string, number>();

  entries.forEach((entry, idx) => {
    const phraseId = entry.phrase.name;
    if (!phraseByName.has(phraseId)) {
      phraseByName.set(phraseId, entry.phrase);
      firstSeenIndexByPhrase.set(phraseId, idx);
    }
    const ordinal = ordinalByEntryId.get(entry.id) ?? 1;
    const prevMax = maxOrdinalByPhrase.get(phraseId) ?? 0;
    if (ordinal > prevMax) maxOrdinalByPhrase.set(phraseId, ordinal);

    if (isAttempt(entry.event) && !entry.event.isAccuracySuccess) {
      failedAttemptsByPhrase.set(
        phraseId,
        (failedAttemptsByPhrase.get(phraseId) ?? 0) + 1,
      );
    }
  });

  const rows: PhraseRevisitRow[] = [];
  for (const [phraseId, phrase] of phraseByName) {
    const failedAttempts = failedAttemptsByPhrase.get(phraseId) ?? 0;
    if (failedAttempts === 0) continue;
    const maxOrdinal = maxOrdinalByPhrase.get(phraseId) ?? 1;
    const revisitCount = Math.max(0, maxOrdinal - 1);
    rows.push({
      phrase,
      revisitCount,
      failedAttempts,
      lastEventSeq: lastEventSeqByPhrase.get(phraseId) ?? 0,
    });
  }

  rows.sort(
    (a, b) =>
      (firstSeenIndexByPhrase.get(a.phrase.name) ?? 0) -
      (firstSeenIndexByPhrase.get(b.phrase.name) ?? 0),
  );

  return {
    once: rows.filter((r) => r.failedAttempts === 1),
    twice: rows.filter((r) => r.failedAttempts === 2),
    threePlus: rows.filter((r) => r.failedAttempts >= 3),
  };
};

export interface PhraseMasteryRow {
  phrase: Phrase;
  masteryScore: number;
  state: PhraseState;
  /**
   * `#` column for this phrase’s last history row — `eventSeq` when set, else
   * 1-based chronological index (matches `SessionHistoryLogView`).
   */
  lastEventSeq: number;
}

/**
 * Joins the phrase data referenced by `entries` with `progress[]` from the
 * completion checkpoint and returns the rows ordered ascending by mastery
 * (lowest first — what the learner should work on).
 *
 * Phrases without a progress entry (e.g. dropped before scoring updated) are
 * still returned with `masteryScore = 0` and `state = 'new'`.
 */
export const buildPhrasesByMasterScore = (
  entries: readonly HistoryEntry[],
  progress: readonly PhraseProgress[],
): PhraseMasteryRow[] => {
  const lastEventSeqByPhrase = lastHistoryDisplaySeqByPhrase(entries);
  const phraseByName = new Map<string, Phrase>();
  for (const entry of entries) {
    phraseByName.set(entry.phrase.name, entry.phrase);
  }

  const rows: PhraseMasteryRow[] = [];
  const seenPhraseIds = new Set<string>();

  for (const p of progress) {
    const phrase = phraseByName.get(p.phraseId);
    if (!phrase) continue;
    rows.push({
      phrase,
      masteryScore: p.masteryScore,
      state: p.state,
      lastEventSeq: lastEventSeqByPhrase.get(p.phraseId) ?? 0,
    });
    seenPhraseIds.add(p.phraseId);
  }

  for (const [phraseId, phrase] of phraseByName) {
    if (seenPhraseIds.has(phraseId)) continue;
    rows.push({
      phrase,
      masteryScore: 0,
      state: 'new',
      lastEventSeq: lastEventSeqByPhrase.get(phraseId) ?? 0,
    });
  }

  rows.sort((a, b) => a.masteryScore - b.masteryScore);
  return rows;
};

/**
 * Helper to count distinct events that occurred during reveals — used by the
 * report header summary chip in some cases.
 */
export const countRevealEvents = (entries: readonly HistoryEntry[]): number =>
  entries.filter((h): h is HistoryEntry & { event: RevealEvent } =>
    h.event.eventType === 'reveal',
  ).length;

/**
 * Helper to count practice events.
 */
export const countPracticeEvents = (entries: readonly HistoryEntry[]): number =>
  entries.filter((h): h is HistoryEntry & { event: PracticeAttempt } =>
    h.event.eventType === 'practice',
  ).length;

// ─── Report eligibility threshold ────────────────────────────────────────────

/**
 * Minimum effective trial count required for a word or grammar item to appear
 * in report rankings and aggregate report metrics. Items below this threshold
 * lack sufficient evidence and would distort summaries (e.g. a single lucky
 * or unlucky trial dominating "lowest first" lists).
 */
export const MIN_REPORT_ITEM_TRIALS = 3;

/**
 * Returns true when a word or grammar item row has enough evidence to be
 * included in report rankings, mastery health summaries, and POS averages.
 *
 * A row qualifies when it is trained (`!isUntrained`) and its effective trial
 * count meets the minimum threshold.
 */
export const isReportEligibleItem = (row: {
  isUntrained: boolean;
  trialsEff: number;
}): boolean => !row.isUntrained && row.trialsEff >= MIN_REPORT_ITEM_TRIALS;

// ─── Per-word and per-grammar-item mastery helpers ────────────────────────────

export interface WordMasteryRow {
  /** Normalized word string (lowercase, diacritic-normalized per `normalizeStr`). */
  word: string;
  /** Display form: the first raw word string seen across all phrases. */
  displayWord: string;
  type: PartOfSpeech;
  mastery: number;
  trialsEff: number;
  stability: number;
  lastUpdatedAtEventSeq: number;
  /** Phrase slugs in which this word appeared in the lesson deck. */
  appearedInPhraseIds: string[];
  /**
   * True when the tracker has never recorded a trial for this word.
   * Shows `—` instead of `0%` in the UI.
   */
  isUntrained: boolean;
}

export interface GrammarMasteryRow {
  /** Grammar item string (comma-split token from Spanish.grammar). */
  item: string;
  mastery: number;
  trialsEff: number;
  stability: number;
  lastUpdatedAtEventSeq: number;
  /**
   * The most recent AI rationale string from any unresolved
   * `IncorrectPhraseRecord.incorrectGrammarItems` entry for this item.
   * Undefined when the AI has never flagged this item or all flags resolved.
   */
  latestRationale?: string;
  /** Phrase slugs in which this grammar item appeared in the lesson deck. */
  phraseIds: string[];
  isUntrained: boolean;
}

export interface ItemBandSummary {
  weak: number;
  stabilizing: number;
  mastered: number;
  untrained: number;
  total: number;
}

/**
 * Builds a merged word-mastery ranking from the lesson history and the
 * cross-phrase wordScores map from the session checkpoint. Words that appeared
 * in the lesson deck but have no score entry are included with `isUntrained:
 * true` and `mastery: 0` so they always sort to the bottom of the ranking.
 *
 * Sorted ascending by mastery (lowest first). Untrained rows are sorted below
 * all trained rows.
 */
export const buildWordsByMastery = (
  entries: readonly HistoryEntry[],
  wordScores: Record<string, ItemScore>,
): WordMasteryRow[] => {
  // Collect all words that appeared in the deck: normalized → { type, displayWord, phraseIds }
  const wordMeta = new Map<
    string,
    { type: PartOfSpeech; displayWord: string; phraseIds: Set<string> }
  >();

  for (const entry of entries) {
    const phraseId = entry.phrase.name;
    for (const w of entry.phrase.Spanish.words) {
      const key = normalizeStr(w.word);
      const existing = wordMeta.get(key);
      if (existing) {
        existing.phraseIds.add(phraseId);
      } else {
        wordMeta.set(key, {
          type: w.type,
          displayWord: w.word,
          phraseIds: new Set([phraseId]),
        });
      }
    }
  }

  const rows: WordMasteryRow[] = [];
  for (const [word, meta] of wordMeta) {
    const score = wordScores[word];
    if (score) {
      rows.push({
        word,
        displayWord: meta.displayWord,
        type: meta.type,
        mastery: score.mastery,
        trialsEff: score.trialsEff,
        stability: score.stability,
        lastUpdatedAtEventSeq: score.lastUpdatedAtEventSeq,
        appearedInPhraseIds: Array.from(meta.phraseIds),
        isUntrained: isUntrained(score),
      });
    } else {
      rows.push({
        word,
        displayWord: meta.displayWord,
        type: meta.type,
        mastery: 0,
        trialsEff: 0,
        stability: 0,
        lastUpdatedAtEventSeq: 0,
        appearedInPhraseIds: Array.from(meta.phraseIds),
        isUntrained: true,
      });
    }
  }

  // Trained rows sorted ascending by mastery; untrained rows last (alphabetical within).
  rows.sort((a, b) => {
    if (a.isUntrained !== b.isUntrained) return a.isUntrained ? 1 : -1;
    if (a.mastery !== b.mastery) return a.mastery - b.mastery;
    return a.word.localeCompare(b.word);
  });

  return rows;
};

/**
 * Partitions `WordMasteryRow[]` by part of speech. Parts of speech with no
 * rows are omitted from the result. The rows within each group preserve the
 * same sort order produced by `buildWordsByMastery`.
 */
export const groupWordsByPos = (
  rows: readonly WordMasteryRow[],
): Partial<Record<PartOfSpeech, WordMasteryRow[]>> => {
  const grouped: Partial<Record<PartOfSpeech, WordMasteryRow[]>> = {};
  for (const row of rows) {
    const group = grouped[row.type];
    if (group) {
      group.push(row);
    } else {
      grouped[row.type] = [row];
    }
  }
  return grouped;
};

/**
 * Builds a grammar-item mastery ranking from the lesson history and the
 * cross-phrase `grammarItemScores` map. Grammar items that appeared in the
 * lesson deck but have no score entry are included with `isUntrained: true`.
 * The `latestRationale` is pulled from the most recent unresolved entry across
 * all `IncorrectPhraseRecord.incorrectGrammarItems` for that item.
 *
 * Sorted ascending by mastery (lowest first). Untrained rows are sorted last.
 */
export const buildGrammarItemsByMastery = (
  entries: readonly HistoryEntry[],
  grammarItemScores: Record<string, ItemScore>,
  incorrectPhraseRecords: readonly IncorrectPhraseRecord[],
): GrammarMasteryRow[] => {
  // Collect all grammar items from the deck.
  const itemMeta = new Map<string, Set<string>>(); // item → phraseId set
  for (const entry of entries) {
    const phraseId = entry.phrase.name;
    const items = entry.phrase.Spanish.grammar
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const item of items) {
      const existing = itemMeta.get(item);
      if (existing) {
        existing.add(phraseId);
      } else {
        itemMeta.set(item, new Set([phraseId]));
      }
    }
  }

  // Build a map of item → latest rationale from unresolved incorrect entries.
  // "Latest" = highest `failedAtEventSeq` among matching entries.
  const latestRationaleByItem = new Map<string, { rationale: string; failedAtEventSeq: number }>();
  for (const record of incorrectPhraseRecords) {
    for (const entry of record.incorrectGrammarItems) {
      if (!entry.rationale) continue;
      const existing = latestRationaleByItem.get(entry.item);
      if (
        !existing ||
        record.failedAtEventSeq > existing.failedAtEventSeq
      ) {
        latestRationaleByItem.set(entry.item, {
          rationale: entry.rationale,
          failedAtEventSeq: record.failedAtEventSeq,
        });
      }
    }
  }

  const rows: GrammarMasteryRow[] = [];
  for (const [item, phraseSet] of itemMeta) {
    const score = grammarItemScores[item];
    const rationaleEntry = latestRationaleByItem.get(item);
    if (score) {
      rows.push({
        item,
        mastery: score.mastery,
        trialsEff: score.trialsEff,
        stability: score.stability,
        lastUpdatedAtEventSeq: score.lastUpdatedAtEventSeq,
        latestRationale: rationaleEntry?.rationale,
        phraseIds: Array.from(phraseSet),
        isUntrained: isUntrained(score),
      });
    } else {
      rows.push({
        item,
        mastery: 0,
        trialsEff: 0,
        stability: 0,
        lastUpdatedAtEventSeq: 0,
        latestRationale: rationaleEntry?.rationale,
        phraseIds: Array.from(phraseSet),
        isUntrained: true,
      });
    }
  }

  rows.sort((a, b) => {
    if (a.isUntrained !== b.isUntrained) return a.isUntrained ? 1 : -1;
    if (a.mastery !== b.mastery) return a.mastery - b.mastery;
    return a.item.localeCompare(b.item);
  });

  return rows;
};

/**
 * Counts how many rows fall into each mastery band (weak / stabilizing /
 * mastered) and how many are untrained. Accepts both `WordMasteryRow[]` and
 * `GrammarMasteryRow[]` — any array of objects with `mastery` and `isUntrained`.
 */
export const summarizeItemBands = (
  rows: readonly { mastery: number; isUntrained: boolean }[],
): ItemBandSummary => {
  let weak = 0;
  let stabilizing = 0;
  let mastered = 0;
  let untrained = 0;

  for (const row of rows) {
    if (row.isUntrained) {
      untrained++;
    } else {
      const band: ItemMasteryBand = classifyItemMastery(row.mastery);
      if (band === 'weak') weak++;
      else if (band === 'stabilizing') stabilizing++;
      else mastered++;
    }
  }

  return { weak, stabilizing, mastered, untrained, total: rows.length };
};

/**
 * Computes the average mastery score per part of speech from a word mastery
 * row list. Parts of speech with only untrained rows return `null` (no data).
 * Parts of speech not present in the list are omitted from the result.
 */
export const averageMasteryByPos = (
  rows: readonly WordMasteryRow[],
): Partial<Record<PartOfSpeech, number | null>> => {
  const sums: Partial<Record<PartOfSpeech, { sum: number; count: number }>> = {};

  for (const row of rows) {
    if (row.isUntrained) continue;
    const pos = row.type;
    const existing = sums[pos];
    if (existing) {
      existing.sum += row.mastery;
      existing.count++;
    } else {
      sums[pos] = { sum: row.mastery, count: 1 };
    }
  }

  const result: Partial<Record<PartOfSpeech, number | null>> = {};
  // Include all POS values that appeared in the rows, marking untrained-only ones as null.
  const posInRows = new Set(rows.map((r) => r.type));
  for (const pos of PART_OF_SPEECH_VALUES) {
    if (!posInRows.has(pos)) continue;
    const entry = sums[pos];
    result[pos] = entry && entry.count > 0 ? entry.sum / entry.count : null;
  }

  return result;
};

// ─── Item mastery trail helpers ───────────────────────────────────────────────

/**
 * True when `phrase.Spanish.words` contains a word that normalizes to
 * `normalizedWord` (uses the same `normalizeStr` used by the tracker).
 */
export const phraseContainsNormalizedWord = (
  phrase: Phrase,
  normalizedWord: string,
): boolean =>
  phrase.Spanish.words.some((w) => normalizeStr(w.word) === normalizedWord);

/**
 * True when `phrase.Spanish.grammar` contains `item` as one of its
 * comma-separated tokens (trimmed, exact match — mirrors `buildGrammarItemsByMastery`).
 */
export const phraseContainsGrammarItem = (
  phrase: Phrase,
  item: string,
): boolean =>
  phrase.Spanish.grammar
    .split(',')
    .map((s) => s.trim())
    .includes(item);

/**
 * Returns the chronological subset of `entries` where:
 *  - the phrase contains `normalizedWord`, and
 *  - the event type is `attempt` or `reveal` (practice does not update item mastery).
 *
 * Order is preserved (lesson chronological order = input array order).
 */
export const filterHistoryEntriesForWordItemTrail = (
  normalizedWord: string,
  entries: readonly HistoryEntry[],
): HistoryEntry[] =>
  entries.filter(
    (e) =>
      (e.event.eventType === 'attempt' || e.event.eventType === 'reveal') &&
      phraseContainsNormalizedWord(e.phrase, normalizedWord),
  );

/**
 * Returns the chronological subset of `entries` where:
 *  - the phrase contains `item` in `Spanish.grammar`, and
 *  - the event type is `attempt` or `reveal`.
 *
 * Note: `applyAiGrading` may skip a grammar bump for the "ambiguous" case
 * (not-failed AND accuracy failure), so this list is an approximation —
 * it may include at most one extra entry per ambiguous attempt.
 */
export const filterHistoryEntriesForGrammarItemTrail = (
  item: string,
  entries: readonly HistoryEntry[],
): HistoryEntry[] =>
  entries.filter(
    (e) =>
      (e.event.eventType === 'attempt' || e.event.eventType === 'reveal') &&
      phraseContainsGrammarItem(e.phrase, item),
  );

export interface ItemScoreLookups {
  grammarItemScoreLookup: ReadonlyMap<string, ItemScore>;
  wordScoreLookup: ReadonlyMap<string, ItemScore>;
}

/**
 * Builds merged word and grammar-item mastery score lookups suitable for
 * passing to `SessionHistoryEntryDetail`.
 *
 * Sources (highest `lastUpdatedAtEventSeq` per key wins):
 *  1. `IncorrectPhraseRecord.incorrectGrammarItems[].score` / `incorrectWordEntries[].score`
 *     (covers failed items with tracker-denormalized scores).
 *  2. `checkpointWordScores` / `checkpointGrammarItemScores` from the session
 *     checkpoint (covers items that were always answered correctly and therefore
 *     never produced an IncorrectPhraseRecord entry).
 */
export const buildItemScoreLookupsForHistoryDetail = (
  incorrectPhraseRecords: readonly IncorrectPhraseRecord[],
  checkpointWordScores: Record<string, ItemScore>,
  checkpointGrammarItemScores: Record<string, ItemScore>,
): ItemScoreLookups => {
  const stash = (
    target: Map<string, ItemScore>,
    key: string,
    score: ItemScore | undefined,
  ): void => {
    if (!score) return;
    const existing = target.get(key);
    if (!existing || score.lastUpdatedAtEventSeq > existing.lastUpdatedAtEventSeq) {
      target.set(key, score);
    }
  };

  const grammar = new Map<string, ItemScore>();
  const word = new Map<string, ItemScore>();

  for (const record of incorrectPhraseRecords) {
    for (const g of record.incorrectGrammarItems) stash(grammar, g.item, g.score);
    for (const w of record.incorrectWordEntries ?? []) stash(word, w.word, w.score);
  }

  for (const [key, score] of Object.entries(checkpointWordScores)) stash(word, key, score);
  for (const [key, score] of Object.entries(checkpointGrammarItemScores)) stash(grammar, key, score);

  return { grammarItemScoreLookup: grammar, wordScoreLookup: word };
};
