import { normalizeStr } from './comparison';
import type { GrammarGradingResult } from './grammarGrading';
import type { Phrase } from './types';

export interface ResolvedWordEntry {
  /** Normalized word string. */
  word: string;
  /** Per-session event sequence number of the resolver event. */
  resolvedByEventSeq: number;
}

/**
 * Per-grammar-item tracking entry. One entry per comma-split token from
 * `Spanish.grammar` that the AI (or fallback) classified as failed.
 */
export interface IncorrectGrammarItemEntry {
  /** The individual grammar item string (one token from Spanish.grammar). */
  item: string;
  /** Per-session event sequence number of the failed attempt. */
  failedAtEventSeq: number;
  /**
   * Per-session event sequence number of the event that demonstrated this
   * grammar item correctly, or null when not yet resolved.
   */
  resolvedByEventSeq: number | null;
  /** AI-generated one-sentence explanation for why this grammar rule was violated. */
  rationale?: string;
}

/**
 * Persistent record for a phrase the user failed at least once this session.
 *
 * All fields use plain arrays/objects (no Map or Set) so records are
 * JSON-serializable without transformation, ready for DB persistence and
 * cross-student analytics queries.
 */
export interface IncorrectPhraseRecord {
  /** The phrase's stable `name` slug. */
  phraseId: string;
  /** Normalized missing words from the most recent failed Attempt. */
  incorrectWords: string[];
  /**
   * One entry per resolved word — the analytics audit trail.
   * `resolvedByEventSeq` is the per-session event sequence number of the
   * event that demonstrated this word correctly.
   */
  resolvedWords: ResolvedWordEntry[];
  /**
   * Per-item grammar tracking (populated by applyAiGrading / applyFallbackClassification).
   * Empty while `grammarGradingStatus === 'pending'`.
   * Contains only the items the AI (or fallback) classified as FAILED.
   */
  incorrectGrammarItems: IncorrectGrammarItemEntry[];
  /**
   * Lifecycle status of the AI grading call for the failed attempt.
   *   - 'pending': AI request in-flight; `incorrectGrammarItems` not yet set.
   *   - 'success': AI returned; `incorrectGrammarItems` is authoritative.
   *   - 'failed': AI timed out/errored; fallback (whole-string item) was used.
   *   - 'n/a': reveal event — immediate fallback, no AI call.
   */
  grammarGradingStatus: 'pending' | 'success' | 'failed' | 'n/a';
  /**
   * Per-session event sequence number of the most recent failed Attempt that
   * produced (or last updated) this record. Used by the resolver event's
   * detail panel to list which failed-phrase events it resolved.
   */
  failedAtEventSeq: number;
  /**
   * True when every word in `incorrectWords` has a corresponding entry in
   * `resolvedWords` AND every item in `incorrectGrammarItems` has a non-null
   * `resolvedByEventSeq` AND `grammarGradingStatus` is not 'pending'.
   * Once true, the phrase is removed from the session re-test queue.
   */
  isFullyResolved: boolean;
}

export interface IncorrectPhraseTracker {
  /**
   * Creates (or refreshes) the incorrect-phrase record for a failed attempt
   * WITHOUT grammar classification. Called synchronously at event time for
   * `attempt` events only.
   *
   * On a failed attempt: upserts the record with `incorrectWords` and sets
   * `grammarGradingStatus = 'pending'`.
   * On an accuracy success: resolves own words (not grammar — deferred to
   * `applyAiGrading`). Does NOT propagate resolution to other records here;
   * call `applyAiGrading` / `applyFallbackClassification` after AI returns.
   *
   * @returns Always an empty array — newly-resolved IDs are computed later
   *   in `applyAiGrading` / `applyFallbackClassification`.
   */
  recordMissingWords(
    phraseId: string,
    phrase: Phrase,
    missingWords: string[],
    isAccuracySuccess: boolean,
    eventSeq: number,
  ): void;

  /**
   * Applies the AI grammar classification result for a previously recorded
   * attempt event. Sets `incorrectGrammarItems` from `result.failedGrammarItems`
   * and propagates resolution of any "demonstrated correctly" grammar items
   * to all other active records. Also propagates correct word usage to other
   * records when `canResolve` is true.
   *
   * @returns phraseIds of records newly marked `isFullyResolved` by this call.
   */
  applyAiGrading(
    phraseId: string,
    phrase: Phrase,
    result: GrammarGradingResult,
    isAccuracySuccess: boolean,
    eventSeq: number,
    canResolve: boolean,
  ): string[];

  /**
   * Fallback for when AI grading fails or for reveal events. Treats the entire
   * `Spanish.grammar` string as a single item (preserves pre-AI behavior).
   * Propagates correct word usage and grammar to other active records when
   * `canResolve` is true.
   *
   * @param gradingStatus 'failed' for AI timeout, 'n/a' for reveal events.
   * @returns phraseIds of records newly marked `isFullyResolved`.
   */
  applyFallbackClassification(
    phraseId: string,
    phrase: Phrase,
    missingWords: string[],
    isAccuracySuccess: boolean,
    eventSeq: number,
    canResolve: boolean,
    gradingStatus: 'failed' | 'n/a',
  ): string[];

  /** Returns the record for a phrase, or undefined if it has never failed. */
  getRecord(phraseId: string): IncorrectPhraseRecord | undefined;

  /**
   * All records for the session, including fully-resolved ones.
   * Serializable as-is (plain arrays/objects, no Map or Set).
   */
  getAllRecords(): readonly IncorrectPhraseRecord[];
}

/**
 * Creates an in-memory tracker for the incorrect-phrase redemption feature.
 * One instance per lesson session, created in `useLessonSession`.
 */
export function createIncorrectPhraseTracker(): IncorrectPhraseTracker {
  const records = new Map<string, IncorrectPhraseRecord>();

  const checkFullyResolved = (record: IncorrectPhraseRecord): boolean => {
    if (record.grammarGradingStatus === 'pending') return false;
    const resolvedWordSet = new Set(record.resolvedWords.map((r) => r.word));
    const allWordsResolved = record.incorrectWords.every((w) => resolvedWordSet.has(w));
    const allGrammarResolved = record.incorrectGrammarItems.every(
      (g) => g.resolvedByEventSeq !== null,
    );
    return allWordsResolved && allGrammarResolved;
  };

  const applyCorrectWords = (
    record: IncorrectPhraseRecord,
    correctWordSet: ReadonlySet<string>,
    resolverEventSeq: number,
  ): void => {
    const alreadyResolved = new Set(record.resolvedWords.map((r) => r.word));
    for (const word of record.incorrectWords) {
      if (correctWordSet.has(word) && !alreadyResolved.has(word)) {
        record.resolvedWords.push({ word, resolvedByEventSeq: resolverEventSeq });
        alreadyResolved.add(word);
      }
    }
  };

  const applyCorrectGrammarItems = (
    record: IncorrectPhraseRecord,
    demonstratedCorrectItems: ReadonlySet<string>,
    resolverEventSeq: number,
  ): void => {
    for (const entry of record.incorrectGrammarItems) {
      if (entry.resolvedByEventSeq === null && demonstratedCorrectItems.has(entry.item)) {
        entry.resolvedByEventSeq = resolverEventSeq;
      }
    }
  };

  const finalize = (
    phraseId: string,
    record: IncorrectPhraseRecord,
    newlyResolved: string[],
  ): void => {
    if (!record.isFullyResolved && checkFullyResolved(record)) {
      record.isFullyResolved = true;
      newlyResolved.push(phraseId);
    }
  };

  return {
    recordMissingWords(phraseId, phrase, missingWords, isAccuracySuccess, eventSeq) {
      const normalizedMissingSet = new Set(missingWords.map((w) => normalizeStr(w)));

      if (!isAccuracySuccess) {
        records.set(phraseId, {
          phraseId,
          incorrectWords: Array.from(normalizedMissingSet),
          resolvedWords: [],
          incorrectGrammarItems: [],
          grammarGradingStatus: 'pending',
          failedAtEventSeq: eventSeq,
          isFullyResolved: false,
        });
      } else {
        const ownRecord = records.get(phraseId);
        if (ownRecord && !ownRecord.isFullyResolved) {
          const correctWordSet = new Set(
            phrase.Spanish.words
              .map((w) => normalizeStr(w.word))
              .filter((w) => !normalizedMissingSet.has(w)),
          );
          applyCorrectWords(ownRecord, correctWordSet, eventSeq);
        }
      }
    },

    applyAiGrading(phraseId, phrase, result, isAccuracySuccess, eventSeq, canResolve) {
      const newlyResolved: string[] = [];

      const allGrammarItems = phrase.Spanish.grammar
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const failedMap = new Map(result.failedGrammarItems.map((f) => [f.item, f]));
      const demonstratedCorrectItems = new Set(
        allGrammarItems.filter((item) => !failedMap.has(item)),
      );

      const ownRecord = records.get(phraseId);
      if (ownRecord && ownRecord.grammarGradingStatus === 'pending') {
        ownRecord.grammarGradingStatus = 'success';
        if (!isAccuracySuccess) {
          ownRecord.incorrectGrammarItems = result.failedGrammarItems.map((f) => ({
            item: f.item,
            rationale: f.rationale,
            failedAtEventSeq: ownRecord.failedAtEventSeq,
            resolvedByEventSeq: null,
          }));
        } else {
          ownRecord.incorrectGrammarItems = result.failedGrammarItems.map((f) => ({
            item: f.item,
            rationale: f.rationale,
            failedAtEventSeq: ownRecord.failedAtEventSeq,
            resolvedByEventSeq: eventSeq,
          }));
        }
        finalize(phraseId, ownRecord, newlyResolved);
      }

      if (canResolve && isAccuracySuccess) {
        const normalizedMissingSet = new Set<string>();
        const correctWordSet = new Set(
          phrase.Spanish.words
            .map((w) => normalizeStr(w.word))
            .filter((w) => !normalizedMissingSet.has(w)),
        );

        for (const [id, record] of records) {
          if (id === phraseId || record.isFullyResolved) continue;
          if (record.grammarGradingStatus === 'pending') continue;

          applyCorrectWords(record, correctWordSet, eventSeq);
          applyCorrectGrammarItems(record, demonstratedCorrectItems, eventSeq);
          finalize(id, record, newlyResolved);
        }
      }

      return newlyResolved;
    },

    applyFallbackClassification(
      phraseId,
      phrase,
      missingWords,
      isAccuracySuccess,
      eventSeq,
      canResolve,
      gradingStatus,
    ) {
      const newlyResolved: string[] = [];
      const normalizedMissingSet = new Set(missingWords.map((w) => normalizeStr(w)));
      const correctWordSet = new Set(
        phrase.Spanish.words
          .map((w) => normalizeStr(w.word))
          .filter((w) => !normalizedMissingSet.has(w)),
      );
      const wholeGrammarString = phrase.Spanish.grammar;

      let ownRecord = records.get(phraseId);
      if (!isAccuracySuccess) {
        ownRecord = {
          phraseId,
          incorrectWords: Array.from(normalizedMissingSet),
          resolvedWords: [],
          incorrectGrammarItems: [
            {
              item: wholeGrammarString,
              failedAtEventSeq: eventSeq,
              resolvedByEventSeq: null,
            },
          ],
          grammarGradingStatus: gradingStatus,
          failedAtEventSeq: eventSeq,
          isFullyResolved: false,
        };
        records.set(phraseId, ownRecord);
      } else if (ownRecord && !ownRecord.isFullyResolved) {
        if (ownRecord.grammarGradingStatus === 'pending') {
          ownRecord.grammarGradingStatus = gradingStatus;
          ownRecord.incorrectGrammarItems = [
            {
              item: wholeGrammarString,
              failedAtEventSeq: ownRecord.failedAtEventSeq,
              resolvedByEventSeq: null,
            },
          ];
        }
        applyCorrectWords(ownRecord, correctWordSet, eventSeq);
        for (const entry of ownRecord.incorrectGrammarItems) {
          if (entry.resolvedByEventSeq === null && entry.item === wholeGrammarString) {
            entry.resolvedByEventSeq = eventSeq;
          }
        }
        finalize(phraseId, ownRecord, newlyResolved);
      }

      if (canResolve) {
        const demonstratedCorrect = isAccuracySuccess
          ? new Set([wholeGrammarString])
          : new Set<string>();

        for (const [id, record] of records) {
          if (id === phraseId || record.isFullyResolved) continue;
          if (record.grammarGradingStatus === 'pending') continue;

          applyCorrectWords(record, correctWordSet, eventSeq);
          if (isAccuracySuccess) {
            applyCorrectGrammarItems(record, demonstratedCorrect, eventSeq);
          }
          finalize(id, record, newlyResolved);
        }
      }

      return newlyResolved;
    },

    getRecord(phraseId) {
      return records.get(phraseId);
    },

    getAllRecords() {
      return Array.from(records.values());
    },
  };
}
