import { z } from 'zod';
import { historyEntrySchema } from './sessionHistory';
import { sessionCheckpointSchema } from './sessionCheckpoint';
import { grammarSummarySchema } from './grammarSummary';

/**
 * Persisted artifact when the learner finishes a lesson (queue drained).
 * `runId` is client-generated once per mounted session and used as an idempotency key.
 */
export const lessonSessionCompletionPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(8).max(220),
  lessonId: z.string().min(1),
  lessonTitle: z.string().optional(),
  /** Epoch ms when the client recorded completion (`Date.now()`). */
  completedAtMs: z.number().int().nonnegative(),
  entries: z.array(historyEntrySchema),
  checkpoint: sessionCheckpointSchema,
  /**
   * AI-generated summaries for the worst weak/stabilizing grammar items.
   * Generated server-side at completion time; absent on older persisted records.
   */
  grammarSummaries: z.array(grammarSummarySchema).optional(),
});

export type LessonSessionCompletionPayload = z.infer<
  typeof lessonSessionCompletionPayloadSchema
>;
