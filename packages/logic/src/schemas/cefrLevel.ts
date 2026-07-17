import { z } from 'zod';

/** Single source of truth for valid CEFR levels (DB CHECK constraints, Settings picker, API validation). */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export const cefrLevelSchema = z.enum(CEFR_LEVELS);

export type CefrLevel = z.infer<typeof cefrLevelSchema>;

/**
 * On-disk shape of `input/cefr_levels/<levelSlug>/words.json`. Words are
 * grouped by a loose category label (e.g. "nouns", "interjections") — not
 * constrained to `PartOfSpeech`, since some categories (like interjections)
 * have no POS-weight equivalent.
 */
export const cefrLevelWordsFileSchema = z.object({
  meta: z.object({
    outputRoot: z.string().optional(),
    courseLevelSlug: z.string().min(1),
  }),
  words: z.record(z.string(), z.array(z.string())),
});

export type CefrLevelWordsFile = z.infer<typeof cefrLevelWordsFileSchema>;

/**
 * On-disk shape of `input/cefr_levels/<levelSlug>/grammar.json`. Grammar item
 * strings must match the exact tokens used in lesson content's `Spanish.grammar`.
 */
export const cefrLevelGrammarFileSchema = z.object({
  meta: z.object({
    outputRoot: z.string().optional(),
    courseLevelSlug: z.string().min(1),
  }),
  grammar: z.array(z.string()),
});

export type CefrLevelGrammarFile = z.infer<typeof cefrLevelGrammarFileSchema>;
