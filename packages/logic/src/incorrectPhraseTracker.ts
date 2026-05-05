import { normalizeStr } from './comparison';
import type { Phrase } from './types';

export interface ResolvedWordEntry {
  /** Normalized word string. */
  word: string;
  /** `phrase.index` of the phrase where this word was correctly spoken. */
  resolvedByPhraseIndex: number;
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
   * `resolvedByPhraseIndex` identifies which subsequent phrase demonstrated
   * that word correctly.
   */
  resolvedWords: ResolvedWordEntry[];
  /**
   * `Spanish.grammar` from the failed phrase. `Spanish.newGrammar` is only a
   * highlighted subset and is not tracked separately.
   */
  incorrectGrammar: string;
  /**
   * `phrase.index` of the fully-passed phrase that shared the same
   * `Spanish.grammar` string, or null when not yet resolved.
   */
  grammarResolvedByPhraseIndex: number | null;
  /**
   * True when every word in `incorrectWords` has a corresponding entry in
   * `resolvedWords` AND `grammarResolvedByPhraseIndex` is non-null.
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
   * @returns phraseIds of records newly marked `isFullyResolved` by this
   *   attempt. The caller is responsible for calling
   *   `engine.removeAndPreventRequeue` for each returned id.
   */
  recordAttempt(
    phraseId: string,
    phrase: Phrase,
    missingWords: string[],
    isAccuracySuccess: boolean,
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
    if (record.grammarResolvedByPhraseIndex === null) return false;
    const resolvedWordSet = new Set(record.resolvedWords.map((r) => r.word));
    return record.incorrectWords.every((w) => resolvedWordSet.has(w));
  };

  const applyCorrectWords = (
    record: IncorrectPhraseRecord,
    correctWordSet: ReadonlySet<string>,
    resolverPhraseIndex: number,
  ): void => {
    const alreadyResolved = new Set(record.resolvedWords.map((r) => r.word));
    for (const word of record.incorrectWords) {
      if (correctWordSet.has(word) && !alreadyResolved.has(word)) {
        record.resolvedWords.push({ word, resolvedByPhraseIndex: resolverPhraseIndex });
        alreadyResolved.add(word);
      }
    }
  };

  return {
    recordAttempt(phraseId, phrase, missingWords, isAccuracySuccess) {
      const normalizedMissingSet = new Set(missingWords.map((w) => normalizeStr(w)));

      const correctWordSet = new Set(
        phrase.Spanish.words
          .map((w) => normalizeStr(w.word))
          .filter((w) => !normalizedMissingSet.has(w)),
      );

      const phraseIndex = phrase.index;
      const newlyResolved: string[] = [];

      if (!isAccuracySuccess) {
        // Upsert record for the current phrase, resetting resolution progress
        // since the user just failed again.
        records.set(phraseId, {
          phraseId,
          incorrectWords: Array.from(normalizedMissingSet),
          resolvedWords: [],
          incorrectGrammar: phrase.Spanish.grammar,
          grammarResolvedByPhraseIndex: null,
          isFullyResolved: false,
        });
      } else {
        // The current phrase passed — self-resolve its record if present.
        const ownRecord = records.get(phraseId);
        if (ownRecord && !ownRecord.isFullyResolved) {
          ownRecord.isFullyResolved = true;
          newlyResolved.push(phraseId);
        }
      }

      // Apply correctly-spoken words (and grammar on success) to all OTHER
      // non-resolved records. Grammar resolution only happens on a full pass
      // since a failed attempt doesn't prove the grammar was applied correctly.
      for (const [id, record] of records) {
        if (id === phraseId || record.isFullyResolved) continue;

        applyCorrectWords(record, correctWordSet, phraseIndex);

        if (
          isAccuracySuccess &&
          record.grammarResolvedByPhraseIndex === null &&
          record.incorrectGrammar === phrase.Spanish.grammar
        ) {
          record.grammarResolvedByPhraseIndex = phraseIndex;
        }

        if (checkFullyResolved(record)) {
          record.isFullyResolved = true;
          newlyResolved.push(id);
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
