import { z } from 'zod';
import { historyEntrySchema } from './sessionHistory';
import { sessionCheckpointSchema } from './sessionCheckpoint';

export const sessionHistoryGetResponseSchema = z.object({
  lessonId: z.string(),
  entries: z.array(historyEntrySchema),
  latestCheckpoint: sessionCheckpointSchema.nullable(),
});

export type SessionHistoryGetResponse = z.infer<
  typeof sessionHistoryGetResponseSchema
>;
