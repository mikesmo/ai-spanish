import { z } from 'zod';

export const resolvedWordEntrySchema = z.object({
  word: z.string(),
  /** Per-session event sequence number of the resolver event. */
  resolvedByEventSeq: z.number().int().positive(),
});

/**
 * Persistent record of a failed phrase attempt and its subsequent resolution
 * history. Designed for JSON serialization (no Map/Set) so it can be stored
 * in a DB and queried for cross-student analytics.
 *
 * Each record is an audit trail: which words were missing, which event (by
 * per-session sequence number) later resolved each word, and which event
 * resolved the grammar rule.
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
   * `Spanish.grammar` from the failed phrase. `Spanish.newGrammar` is only a
   * highlighted subset and is not tracked separately.
   */
  incorrectGrammar: z.string(),
  /**
   * Per-session event sequence number of the fully-passed event that shares
   * the same `Spanish.grammar` string, or null when not yet resolved.
   */
  grammarResolvedByEventSeq: z.number().int().positive().nullable(),
  /**
   * Per-session event sequence number of the most recent failed Attempt that
   * produced (or last updated) this record. Used by the resolver event's
   * detail panel to list "Phrase A event IDs resolved by this success".
   */
  failedAtEventSeq: z.number().int().positive(),
  /** True once both word-resolution and grammar-resolution conditions are met. */
  isFullyResolved: z.boolean(),
});

export type ResolvedWordEntryParsed = z.infer<typeof resolvedWordEntrySchema>;
export type IncorrectPhraseRecordParsed = z.infer<typeof incorrectPhraseRecordSchema>;
