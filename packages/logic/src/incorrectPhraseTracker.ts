import { normalizeStr } from './comparison';
import type { GrammarGradingResult } from './grammarGrading';
import {
  createInitialItemScore,
  decayItemOnReveal,
  updateItemScore,
  type ItemScore,
} from './itemMastery';
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
  /**
   * Cross-phrase mastery snapshot for this grammar item. Denormalized from
   * the tracker's internal `grammarItemScores` map; updated by `bumpGrammarItem`
   * and `decayGrammarItem`. Same value across every entry that has the same
   * `item` string. Undefined until the first trial.
   */
  score?: ItemScore;
}

/**
 * Per-record entry tracking a Spanish word that failed in this phrase at least
 * once. Sibling of {@link IncorrectGrammarItemEntry}. The cross-phrase mastery
 * `score` is denormalized from the tracker's internal `wordScores` map.
 */
export interface WordMistakeEntry {
  /** Normalized word string. */
  word: string;
  /** Per-session event seq of the failed attempt that first recorded this word in this phrase. */
  failedAtEventSeq: number;
  /** Per-session event seq of the resolver event, or null when not yet resolved. */
  resolvedByEventSeq: number | null;
  /** Cross-phrase mastery snapshot for this word. Undefined until the first trial. */
  score?: ItemScore;
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
   * Per-word entries (parallel to `incorrectGrammarItems`) used to carry the
   * cross-phrase mastery score for each missed word in this phrase. Populated
   * by `bumpWord` whenever a word in this phrase produces a trial. The
   * legacy `incorrectWords` / `resolvedWords` fields remain authoritative for
   * the existing word-alignment "missing"/"resolved by" logic; this field
   * exists solely to surface the per-word mastery score.
   */
  incorrectWordEntries: WordMistakeEntry[];
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
    extraWords: string[],
    isAccuracySuccess: boolean,
    eventSeq: number,
  ): void;

  /**
   * Applies the AI grammar classification result for a previously recorded
   * attempt event. Sets `incorrectGrammarItems` from `result.failedGrammarItems`
   * and propagates resolution of any "demonstrated correctly" grammar items
   * to all other active records. Also propagates correct word usage to other
   * records when `canResolve` is true. Updates per-item mastery scores for
   * grammar items (using the AI classification) and words (using
   * `missingWords`).
   *
   * @param missingWords The original missing-words list from the attempt
   *   event (passed through from `pendingGradingMapRef`); needed to derive
   *   per-word x outcomes for mastery scoring.
   * @returns phraseIds of records newly marked `isFullyResolved` by this call.
   */
  applyAiGrading(
    phraseId: string,
    phrase: Phrase,
    result: GrammarGradingResult,
    missingWords: string[],
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

  /**
   * Snapshot of the cross-phrase grammar-item mastery scores. Returned as a
   * plain object map (JSON-friendly). Useful for tests and analytics; the UI
   * reads scores off the entries themselves.
   */
  getGrammarItemScores(): ReadonlyMap<string, ItemScore>;

  /** Snapshot of the cross-phrase word mastery scores. */
  getWordScores(): ReadonlyMap<string, ItemScore>;
}

/**
 * Creates an in-memory tracker for the incorrect-phrase redemption feature.
 * One instance per lesson session, created in `useLessonSession`.
 *
 * When `seedRecords` is provided (e.g. on checkpoint resume), the records and
 * the cross-phrase mastery maps are rebuilt from the parsed entries. For each
 * (item|word) string, the entry with the highest `lastUpdatedAtEventSeq` wins.
 */
export function createIncorrectPhraseTracker(
  seedRecords?: readonly IncorrectPhraseRecord[],
): IncorrectPhraseTracker {
  const records = new Map<string, IncorrectPhraseRecord>();
  /** Cross-phrase grammar item mastery — source of truth during a session. */
  const grammarItemScores = new Map<string, ItemScore>();
  /** Cross-phrase word mastery — source of truth during a session. */
  const wordScores = new Map<string, ItemScore>();

  if (seedRecords) {
    for (const r of seedRecords) {
      // Defensive copy so we don't mutate caller-owned objects.
      records.set(r.phraseId, {
        ...r,
        incorrectWords: [...r.incorrectWords],
        resolvedWords: r.resolvedWords.map((e) => ({ ...e })),
        incorrectGrammarItems: r.incorrectGrammarItems.map((e) => ({ ...e })),
        incorrectWordEntries: (r.incorrectWordEntries ?? []).map((e) => ({ ...e })),
      });
    }
    // Seed cross-phrase score maps (latest-by-eventSeq wins).
    const seedFromEntries = (
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
    for (const r of records.values()) {
      for (const g of r.incorrectGrammarItems) seedFromEntries(grammarItemScores, g.item, g.score);
      for (const w of r.incorrectWordEntries) seedFromEntries(wordScores, w.word, w.score);
    }
  }

  const checkFullyResolved = (record: IncorrectPhraseRecord): boolean => {
    if (record.grammarGradingStatus === 'pending') return false;
    const resolvedWordSet = new Set(record.resolvedWords.map((r) => r.word));
    const allWordsResolved = record.incorrectWords.every((w) => resolvedWordSet.has(w));
    const allGrammarResolved = record.incorrectGrammarItems.every(
      (g) => g.resolvedByEventSeq !== null,
    );
    return allWordsResolved && allGrammarResolved;
  };

  /**
   * Updates the cross-phrase mastery score for a grammar item with one new
   * trial, then fans the resulting `ItemScore` out onto every existing entry
   * with the same `item` string across all records. Snapshots of the same
   * score reference are shared by all entries (entries treat them as
   * read-only, so this is safe).
   */
  const bumpGrammarItem = (item: string, x: number, eventSeq: number): void => {
    const prev = grammarItemScores.get(item) ?? createInitialItemScore();
    const next = updateItemScore(prev, x, eventSeq);
    grammarItemScores.set(item, next);
    for (const record of records.values()) {
      for (const entry of record.incorrectGrammarItems) {
        if (entry.item === item) entry.score = next;
      }
    }
  };

  /**
   * Updates the cross-phrase mastery score for a word with one new trial,
   * then fans the resulting `ItemScore` out onto every existing
   * `WordMistakeEntry` with the same `word` across all records. Also lazily
   * creates a `WordMistakeEntry` on the supplied `originRecord` if one does
   * not already exist (so failures originating in this phrase get a row).
   */
  const bumpWord = (
    word: string,
    x: number,
    eventSeq: number,
    originRecord: IncorrectPhraseRecord | undefined,
  ): void => {
    const prev = wordScores.get(word) ?? createInitialItemScore();
    const next = updateItemScore(prev, x, eventSeq);
    wordScores.set(word, next);
    let originHasEntry = false;
    for (const record of records.values()) {
      for (const entry of record.incorrectWordEntries) {
        if (entry.word === word) {
          entry.score = next;
          if (record === originRecord) originHasEntry = true;
        }
      }
    }
    if (originRecord && !originHasEntry && x < 1) {
      // First time this word fails inside this phrase — lazily create an entry
      // so the UI can render a per-word row. We only create on failures
      // (x < 1); successes for words that have never failed remain implicit.
      originRecord.incorrectWordEntries.push({
        word,
        failedAtEventSeq: eventSeq,
        resolvedByEventSeq: null,
        score: next,
      });
    }
  };

  /**
   * Decay path for reveal events: shrinks `stability` multiplicatively without
   * incrementing the trial count, then fans the new score out onto matching
   * entries (same fan-out pattern as `bumpGrammarItem`). No-op if the item
   * has no prior score.
   */
  const decayGrammarItem = (item: string, eventSeq: number): void => {
    const prev = grammarItemScores.get(item);
    if (!prev) return;
    const next = decayItemOnReveal(prev, eventSeq);
    grammarItemScores.set(item, next);
    for (const record of records.values()) {
      for (const entry of record.incorrectGrammarItems) {
        if (entry.item === item) entry.score = next;
      }
    }
  };

  const decayWord = (word: string, eventSeq: number): void => {
    const prev = wordScores.get(word);
    if (!prev) return;
    const next = decayItemOnReveal(prev, eventSeq);
    wordScores.set(word, next);
    for (const record of records.values()) {
      for (const entry of record.incorrectWordEntries) {
        if (entry.word === word) entry.score = next;
      }
    }
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
    recordMissingWords(phraseId, phrase, missingWords, extraWords, isAccuracySuccess, eventSeq) {
      const normalizedMissingSet = new Set(missingWords.map((w) => normalizeStr(w)));

      if (!isAccuracySuccess) {
        records.set(phraseId, {
          phraseId,
          incorrectWords: Array.from(normalizedMissingSet),
          resolvedWords: [],
          incorrectGrammarItems: [],
          incorrectWordEntries: [],
          grammarGradingStatus: 'pending',
          failedAtEventSeq: eventSeq,
          isFullyResolved: false,
        });
      } else {
        const hasMismatch = missingWords.length > 0 || extraWords.length > 0;
        const ownRecord = records.get(phraseId);

        if (hasMismatch && !ownRecord) {
          // AI grammar grading is in flight for this event (the user did not
          // produce an exact word match even though accuracy cleared the
          // threshold). Create a pending record so the AI result has a place
          // to land. Without this, applyAiGrading silently drops failed items
          // and rationales.
          records.set(phraseId, {
            phraseId,
            incorrectWords: Array.from(normalizedMissingSet),
            resolvedWords: [],
            incorrectGrammarItems: [],
            incorrectWordEntries: [],
            grammarGradingStatus: 'pending',
            failedAtEventSeq: eventSeq,
            isFullyResolved: false,
          });
        } else if (ownRecord && !ownRecord.isFullyResolved) {
          const correctWordSet = new Set(
            phrase.Spanish.words
              .map((w) => normalizeStr(w.word))
              .filter((w) => !normalizedMissingSet.has(w)),
          );
          applyCorrectWords(ownRecord, correctWordSet, eventSeq);
        }
      }
    },

    applyAiGrading(
      phraseId,
      phrase,
      result,
      missingWords,
      isAccuracySuccess,
      eventSeq,
      canResolve,
    ) {
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
        // AI is only called when the attempt was not an exact word match, so
        // any item the AI flags as failed was genuinely not demonstrated — write
        // it as unresolved regardless of isAccuracySuccess. Items the AI did NOT
        // flag are resolved via the cross-record fan-out below (canResolve path).
        ownRecord.incorrectGrammarItems = result.failedGrammarItems.map((f) => ({
          item: f.item,
          rationale: f.rationale,
          failedAtEventSeq: ownRecord.failedAtEventSeq,
          resolvedByEventSeq: null,
        }));
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

      // ---- Per-item mastery updates -----------------------------------------
      // Grammar items: AI-driven. failed -> x=0; not-failed AND accuracy
      // success -> x=1; ambiguous (not-failed AND accuracy failure) -> SKIP.
      const grammarOriginRecord = records.get(phraseId);
      for (const item of allGrammarItems) {
        if (failedMap.has(item)) {
          bumpGrammarItem(item, 0, eventSeq);
        } else if (isAccuracySuccess) {
          bumpGrammarItem(item, 1, eventSeq);
        }
        // else: ambiguous — skip per algorithm spec.
      }
      // Words: derived from the original missingWords list.
      const normalizedMissingForWords = new Set(missingWords.map((w) => normalizeStr(w)));
      for (const w of phrase.Spanish.words) {
        const normalized = normalizeStr(w.word);
        const x = normalizedMissingForWords.has(normalized) ? 0 : 1;
        bumpWord(normalized, x, eventSeq, grammarOriginRecord);
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
          incorrectWordEntries: [],
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

      // ---- Per-item mastery updates -----------------------------------------
      // Reveal events ('n/a'): decay every grammar item and every word in the
      // phrase. No `n` change. AI-failed events ('failed'): skip per-item
      // grammar updates (we have no item-level info — the whole-grammar bucket
      // would pollute scores), but DO update word scores from the alignment.
      const allGrammarItems = phrase.Spanish.grammar
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const fallbackOriginRecord = records.get(phraseId);
      if (gradingStatus === 'n/a') {
        for (const item of allGrammarItems) decayGrammarItem(item, eventSeq);
        for (const w of phrase.Spanish.words) decayWord(normalizeStr(w.word), eventSeq);
      } else {
        for (const w of phrase.Spanish.words) {
          const normalized = normalizeStr(w.word);
          const x = normalizedMissingSet.has(normalized) ? 0 : 1;
          bumpWord(normalized, x, eventSeq, fallbackOriginRecord);
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

    getGrammarItemScores() {
      return grammarItemScores;
    },

    getWordScores() {
      return wordScores;
    },
  };
}
