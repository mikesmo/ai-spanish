import { z } from 'zod';
import { POS_WEIGHTS } from '../weights';
import type { PartOfSpeech } from '../weights';

// Literal tuple so z.enum infers the narrow PartOfSpeech union, not `string`.
export const partOfSpeechSchema = z.enum([
  'verb',
  'noun',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'article',
  'determiner',
] as const satisfies readonly PartOfSpeech[]);

export const wordMetaSchema = z
  .object({
    word: z.string().min(1),
    type: partOfSpeechSchema,
    weight: z.number().positive(),
  })
  .refine(
    (w) => w.weight === POS_WEIGHTS[w.type as keyof typeof POS_WEIGHTS],
    {
      message: 'WordMeta.weight must match POS_WEIGHTS[type]',
    },
  );

/** Canonical values: `new` | `composite`. Legacy `"combination"` normalizes to `composite`. */
const phraseLessonTypeSchema = z
  .union([
    z.enum(['new', 'composite']),
    z.literal('combination').transform(() => 'composite' as const),
  ])
  .optional();

export const phraseSchema = z.object({
  name: z.string().min(1),
  index: z.number().int().nonnegative(),
  category: z.string().optional(),
  type: phraseLessonTypeSchema,
  English: z.object({
    'first-intro': z.string().default(''),
    'second-intro': z.string(),
    question: z.string(),
  }),
  Spanish: z.object({
    grammar: z.string(),
    newGrammar: z.string().optional(),
    newWords: z.string().optional(),
    answer: z.string(),
    words: z.array(wordMetaSchema).min(1),
  }),
});

export const transcriptResponseSchema = z.array(phraseSchema);

export type TranscriptResponse = z.infer<typeof transcriptResponseSchema>;
