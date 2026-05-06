import { normalizeStr } from './comparison';
import type { Phrase } from './types';

export interface ResolvedWordEntry {
  /** Normalized word string. */
  word: string;
  /** Per-session event sequence number of the resolver event. */
  resolvedByEventSeq: number;
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
   * `Spanish.grammar` from the failed phrase. `Spanish.newGrammar` is only a
   * highlighted subset and is not tracked separately.
   */
  incorrectGrammar: string;
  /**
   * Per-session event sequence number of the fully-passed event that shared
   * the same `Spanish.grammar` string, or null when not yet resolved.
   */
  grammarResolvedByEventSeq: number | null;
  /**
   * Per-session event sequence number of the most recent failed Attempt that
   * produced (or last updated) this record. Used by the resolver event's
   * detail panel to list which failed-phrase events it resolved.
   */
  failedAtEventSeq: number;
  /**
   * True when every word in `incorrectWords` has a corresponding entry in
   * `resolvedWords` AND `grammarResolvedByEventSeq` is non-null.
   * Once true, the phrase is removed from the session re-test queue.
   */
  isFullyResolved: boolean;
}

export interface IncorrectPhraseTracker {
  /**
   * Process an Attempt event — call after every attempt regardless of
   * pass/fail. Handles both upserting the current phrase's record (on fail)
   * and propagating correctly-spoken words + grammar to all other active
   * records (on every attempt).
   *
   * Records are never deleted — they persist for the session lifetime so the
   * history sidebar and future analytics always have the full resolution trail.
   *
   * @param eventSeq Per-session monotonic event sequence number for this event.
   * @param canResolve When false (first presentation of a `type="new"` phrase),
   *   the event is skipped entirely — no upserts, no self-resolution, and no
   *   propagation to other records.
   * @returns phraseIds of records newly marked `isFullyResolved` by this
   *   attempt. The caller is responsible for calling
   *   `engine.removeAndPreventRequeue` for each returned id.
   */
  recordAttempt(
    phraseId: string,
    phrase: Phrase,
    missingWords: string[],
    isAccuracySuccess: boolean,
    eventSeq: number,
    canResolve: boolean,
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
    if (record.grammarResolvedByEventSeq === null) return false;
    const resolvedWordSet = new Set(record.resolvedWords.map((r) => r.word));
    return record.incorrectWords.every((w) => resolvedWordSet.has(w));
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

  return {
    recordAttempt(phraseId, phrase, missingWords, isAccuracySuccess, eventSeq, canResolve) {
      const normalizedMissingSet = new Set(missingWords.map((w) => normalizeStr(w)));

      const correctWordSet = new Set(
        phrase.Spanish.words
          .map((w) => normalizeStr(w.word))
          .filter((w) => !normalizedMissingSet.has(w)),
      );

      const newlyResolved: string[] = [];

      // Always upsert the current phrase's record on failure, and always
      // self-resolve on success. This runs even for type="new" first
      // presentations so the failed phrase still appears in tracking.
      if (!isAccuracySuccess) {
        records.set(phraseId, {
          phraseId,
          incorrectWords: Array.from(normalizedMissingSet),
          resolvedWords: [],
          incorrectGrammar: phrase.Spanish.grammar,
          grammarResolvedByEventSeq: null,
          failedAtEventSeq: eventSeq,
          isFullyResolved: false,
        });
      } else {
        const ownRecord = records.get(phraseId);
        if (ownRecord && !ownRecord.isFullyResolved) {
          applyCorrectWords(ownRecord, correctWordSet, eventSeq);
          if (
            isAccuracySuccess &&
            ownRecord.grammarResolvedByEventSeq === null &&
            ownRecord.incorrectGrammar === phrase.Spanish.grammar
          ) {
            ownRecord.grammarResolvedByEventSeq = eventSeq;
          }
          if (checkFullyResolved(ownRecord)) {
            ownRecord.isFullyResolved = true;
            newlyResolved.push(phraseId);
          }
        }
      }

      // Propagation to OTHER records is only allowed when canResolve is true.
      // First presentation of a type="new" phrase is a practice run — the
      // user can reveal the answer, so it does not count as a real test and
      // cannot credit resolution of other phrases.
      if (canResolve) {
        for (const [id, record] of records) {
          if (id === phraseId || record.isFullyResolved) continue;

          applyCorrectWords(record, correctWordSet, eventSeq);

          if (
            isAccuracySuccess &&
            record.grammarResolvedByEventSeq === null &&
            record.incorrectGrammar === phrase.Spanish.grammar
          ) {
            record.grammarResolvedByEventSeq = eventSeq;
          }

          if (checkFullyResolved(record)) {
            record.isFullyResolved = true;
            newlyResolved.push(id);
          }
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
