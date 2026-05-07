import type { Attempt, PhraseEvent, PracticeAttempt, RevealEvent } from './events';
import { buildPresentationOrdinalByEntryId } from './sessionHistoryPresentationOrdinals';
import type { HistoryEntry } from './useSessionHistory';
import type { Phrase, PhraseProgress, PhraseState } from './types';

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
