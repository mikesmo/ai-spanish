import { z } from 'zod';

/**
 * Per-item mastery score serialized on grammar-item / word-mistake entries.
 * See `../itemMastery.ts` for the producing logic. All fields optional+default
 * for backward compatibility with checkpoints written before per-item mastery.
 */
export const itemScoreSchema = z.object({
  trialsEff: z.number(),
  successSumEff: z.number(),
  stability: z.number(),
  mastery: z.number(),
  lastUpdatedAtEventSeq: z.number().int().nonnegative(),
});

export const resolvedWordEntrySchema = z.object({
  word: z.string(),
  /** Per-session event sequence number of the resolver event. */
  resolvedByEventSeq: z.number().int().positive(),
});

export const incorrectGrammarItemEntrySchema = z.object({
  /** The individual grammar item string (one comma-split token from Spanish.grammar). */
  item: z.string(),
  /** Per-session event sequence number of the failed attempt that recorded this item. */
  failedAtEventSeq: z.number().int().positive(),
  /**
   * Per-session event sequence number of the event that resolved this grammar item,
   * or null when not yet resolved.
   */
  resolvedByEventSeq: z.number().int().positive().nullable(),
  /** AI-generated one-sentence explanation for why this grammar rule was violated. */
  rationale: z.string().optional(),
  /** Per-item mastery snapshot for this grammar item. Cross-phrase value. */
  score: itemScoreSchema.optional(),
});

/**
 * Per-record entry tracking a Spanish word that has failed in this phrase at
 * least once. Sibling of `incorrectGrammarItemEntrySchema`. The cross-phrase
 * mastery score is denormalized onto each entry by the tracker.
 */
export const wordMistakeEntrySchema = z.object({
  /** Normalized word string. */
  word: z.string(),
  /** Per-session event seq of the failed attempt that first recorded this word. */
  failedAtEventSeq: z.number().int().positive(),
  /**
   * Per-session event seq of the event that resolved this word in this phrase,
   * or null when not yet resolved.
   */
  resolvedByEventSeq: z.number().int().positive().nullable(),
  /** Per-item mastery snapshot for this word. Cross-phrase value. */
  score: itemScoreSchema.optional(),
});

/**
 * Persistent record of a failed phrase attempt and its subsequent resolution
 * history. Designed for JSON serialization (no Map/Set) so it can be stored
 * in a DB and queried for cross-student analytics.
 *
 * Supports two formats for backward compatibility:
 *   - Legacy (pre-AI grading): uses `incorrectGrammar` + `grammarResolvedByEventSeq`
 *   - New (AI grading): uses `incorrectGrammarItems` + `grammarGradingStatus`
 */
export const incorrectPhraseRecordSchema = z.object({
  /** The phrase's stable `name` slug. */
  phraseId: z.string(),
  /** Normalized missing words from the most recent failed Attempt. */
  incorrectWords: z.array(z.string()),
  /**
   * One entry per resolved word. The resolver's per-session `eventSeq` is
   * stored so the sidebar can link "Phrase B event #N resolved this word".
   */
  resolvedWords: z.array(resolvedWordEntrySchema),

  /**
   * @deprecated Legacy field — whole grammar string from Spanish.grammar.
   * Kept optional for backward compatibility when loading old checkpoints.
   * New records use `incorrectGrammarItems` instead.
   */
  incorrectGrammar: z.string().optional(),
  /**
   * @deprecated Legacy field — per-session event seq resolving the grammar bucket.
   * Kept optional for backward compatibility when loading old checkpoints.
   */
  grammarResolvedByEventSeq: z.number().int().positive().nullable().optional(),

  /**
   * Per-item grammar tracking introduced with AI grading.
   * One entry per grammar item (comma-split token from Spanish.grammar) that
   * the AI classified as failed. Empty when all mistakes were word-choice
   * driven; populated by `applyAiGrading` / `applyFallbackClassification`.
   * Defaults to [] so old checkpoint records (without this field) still
   * produce a value assignable to `IncorrectPhraseRecord`.
   */
  incorrectGrammarItems: z.array(incorrectGrammarItemEntrySchema).optional().default([]),
  /**
   * Lifecycle status of the AI grading call for the failed attempt that
   * created this record.
   *   - 'pending': AI request in-flight, grammar items not yet classified.
   *   - 'success': AI returned; `incorrectGrammarItems` is authoritative.
   *   - 'failed': AI timed out / errored; `incorrectGrammarItems` uses fallback
   *     (whole grammar string as one item).
   *   - 'n/a': reveal event — no AI grading.
   * Defaults to 'n/a' for old checkpoint records without this field.
   */
  grammarGradingStatus: z.enum(['pending', 'success', 'failed', 'n/a']).optional().default('n/a'),

  /**
   * Per-word entries (parallel to `incorrectGrammarItems`) used to carry the
   * cross-phrase mastery score for each missed word. Defaults to [] so old
   * checkpoint records (without this field) parse successfully.
   */
  incorrectWordEntries: z.array(wordMistakeEntrySchema).optional().default([]),

  /**
   * Per-session event sequence number of the most recent failed Attempt that
   * produced (or last updated) this record. Used by the resolver event's
   * detail panel to list "Phrase A event IDs resolved by this success".
   */
  failedAtEventSeq: z.number().int().positive(),
  /** True once both word-resolution and grammar-resolution conditions are met. */
  isFullyResolved: z.boolean(),
});

export type ItemScoreParsed = z.infer<typeof itemScoreSchema>;
export type ResolvedWordEntryParsed = z.infer<typeof resolvedWordEntrySchema>;
export type IncorrectGrammarItemEntryParsed = z.infer<typeof incorrectGrammarItemEntrySchema>;
export type WordMistakeEntryParsed = z.infer<typeof wordMistakeEntrySchema>;
export type IncorrectPhraseRecordParsed = z.infer<typeof incorrectPhraseRecordSchema>;
