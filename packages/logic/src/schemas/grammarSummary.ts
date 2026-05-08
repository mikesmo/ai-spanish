import { z } from 'zod';

/**
 * AI-generated per-grammar-item summary produced at lesson completion.
 * `status === 'success'` means `struggling` and `focus` are populated.
 * `status === 'error'` means the AI call failed; `errorReason` is set.
 */
export const grammarSummarySchema = z.object({
  item: z.string(),
  mastery: z.number(),
  band: z.enum(['weak', 'stabilizing']),
  trialsEff: z.number(),
  attemptCount: z.number().int().nonnegative(),
  status: z.enum(['success', 'error']),
  /** What the student is struggling with. Present when `status === 'success'`. */
  struggling: z.string().optional(),
  /** What the student should focus on to improve. Present when `status === 'success'`. */
  focus: z.string().optional(),
  /** Brief reason the AI call failed. Present when `status === 'error'`. */
  errorReason: z.string().optional(),
});

export type GrammarSummary = z.infer<typeof grammarSummarySchema>;
