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
}

export interface PhraseRevisitBuckets {
  once: PhraseRevisitRow[];
  twice: PhraseRevisitRow[];
  threePlus: PhraseRevisitRow[];
}

const isAttempt = (event: PhraseEvent): event is Attempt =>
  event.eventType === 'attempt';

/**
 * Buckets phrases by how many times they were revisited (re-presented after
 * the initial card). Phrases that were only shown once and never revisited
 * are excluded entirely.
 */
export const bucketPhrasesByRevisitCount = (
  entries: readonly HistoryEntry[],
): PhraseRevisitBuckets => {
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
  for (const [phraseId, maxOrdinal] of maxOrdinalByPhrase) {
    const revisitCount = Math.max(0, maxOrdinal - 1);
    if (revisitCount === 0) continue;
    const phrase = phraseByName.get(phraseId);
    if (!phrase) continue;
    rows.push({
      phrase,
      revisitCount,
      failedAttempts: failedAttemptsByPhrase.get(phraseId) ?? 0,
    });
  }

  rows.sort(
    (a, b) =>
      (firstSeenIndexByPhrase.get(a.phrase.name) ?? 0) -
      (firstSeenIndexByPhrase.get(b.phrase.name) ?? 0),
  );

  return {
    once: rows.filter((r) => r.revisitCount === 1),
    twice: rows.filter((r) => r.revisitCount === 2),
    threePlus: rows.filter((r) => r.revisitCount >= 3),
  };
};

export interface PhraseMasteryRow {
  phrase: Phrase;
  masteryScore: number;
  state: PhraseState;
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
    });
    seenPhraseIds.add(p.phraseId);
  }

  for (const [phraseId, phrase] of phraseByName) {
    if (seenPhraseIds.has(phraseId)) continue;
    rows.push({ phrase, masteryScore: 0, state: 'new' });
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
