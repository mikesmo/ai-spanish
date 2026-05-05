import { z } from 'zod';

export const resolvedWordEntrySchema = z.object({
  word: z.string(),
  resolvedByPhraseIndex: z.number().int().nonnegative(),
});

/**
 * Persistent record of a failed phrase attempt and its subsequent resolution
 * history. Designed for JSON serialization (no Map/Set) so it can be stored
 * in a DB and queried for cross-student analytics.
 *
 * Each record is an audit trail: which words were missing, which phrase (by
 * index) later resolved each word, and which phrase resolved the grammar rule.
 */
export const incorrectPhraseRecordSchema = z.object({
  /** The phrase's stable `name` slug. */
  phraseId: z.string(),
  /** Normalized missing words from the most recent failed Attempt. */
  incorrectWords: z.array(z.string()),
  /**
   * One entry per resolved word. The resolver's `phrase.index` is stored so
   * analytics can answer "phrase B resolved word X from phrase A".
   */
  resolvedWords: z.array(resolvedWordEntrySchema),
  /**
   * `Spanish.grammar` from the failed phrase. `Spanish.newGrammar` is only a
   * highlighted subset and is not tracked separately.
   */
  incorrectGrammar: z.string(),
  /**
   * `phrase.index` of the fully-passed phrase that shares the same
   * `Spanish.grammar` string, or null if not yet resolved.
   */
  grammarResolvedByPhraseIndex: z.number().int().nonnegative().nullable(),
  /** True once both word-resolution and grammar-resolution conditions are met. */
  isFullyResolved: z.boolean(),
});

export type ResolvedWordEntryParsed = z.infer<typeof resolvedWordEntrySchema>;
export type IncorrectPhraseRecordParsed = z.infer<typeof incorrectPhraseRecordSchema>;
