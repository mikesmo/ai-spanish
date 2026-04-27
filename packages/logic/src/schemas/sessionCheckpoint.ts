import { z } from 'zod';

export const phraseProgressSchema = z.object({
  phraseId: z.string(),
  masteryScore: z.number(),
  stabilityScore: z.number(),
  state: z.enum(['new', 'learning', 'stabilizing', 'mastered']),
  lastSeenAt: z.number(),
  dueOnLessonSessionIndex: z.number(),
  srsSpacingLessons: z.number(),
});

export const sessionCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  lessonId: z.string(),
  /** Ordered phrase ids remaining in the session queue (the next card to play is first). */
  queuePhraseIds: z.array(z.string()),
  /** The phrase id returned by the last `pickNext()`, or null if nothing has been picked yet. */
  currentPresentedPhraseId: z.string().nullable(),
  /** Per-phrase reinsert counts — serialised as a plain object for JSON safety. */
  reinsertCount: z.record(z.string(), z.number()),
  /** Full progress store snapshot (one entry per phrase touched during the session). */
  progress: z.array(phraseProgressSchema),
  completedLessonCount: z.number(),
  /**
   * Sorted, comma-joined phrase ids from the loaded deck. Used to reject
   * checkpoints that were built with a different deck version.
   */
  deckFingerprint: z.string().optional(),
});

export type SessionCheckpointParsed = z.infer<typeof sessionCheckpointSchema>;
