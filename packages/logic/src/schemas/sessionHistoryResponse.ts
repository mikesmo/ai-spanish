import { z } from 'zod';
import { historyEntrySchema } from './sessionHistory';
import { sessionCheckpointSchema } from './sessionCheckpoint';
import { grammarSummarySchema } from './grammarSummary';

export const sessionHistoryGetResponseSchema = z.object({
  lessonId: z.string(),
  entries: z.array(historyEntrySchema),
  latestCheckpoint: sessionCheckpointSchema.nullable(),
  /**
   * AI-generated summaries for the worst weak/stabilizing grammar items.
   * Generated at completion time; absent for older completions.
   */
  grammarSummaries: z.array(grammarSummarySchema).optional(),
});

export type SessionHistoryGetResponse = z.infer<
  typeof sessionHistoryGetResponseSchema
>;
