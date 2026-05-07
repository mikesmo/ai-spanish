import { z } from 'zod';
import { incorrectPhraseRecordSchema } from './incorrectPhraseRecord';

export const phraseProgressSchema = z.object({
  phraseId: z.string(),
  masteryScore: z.number(),
  stabilityScore: z.number(),
  state: z.enum(['new', 'learning', 'stabilizing', 'mastered']),
  lastSeenAt: z.number(),
  /** @deprecated Removed — kept optional for parsing legacy stored checkpoints. */
  dueOnLessonSessionIndex: z.number().optional(),
  /** @deprecated Removed — kept optional for parsing legacy stored checkpoints. */
  srsSpacingLessons: z.number().optional(),
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
  /** @deprecated Removed — kept optional for parsing legacy stored checkpoints. */
  completedLessonCount: z.number().optional(),
  /**
   * Sorted, comma-joined phrase ids from the loaded deck. Used to reject
   * checkpoints that were built with a different deck version.
   */
  deckFingerprint: z.string().optional(),
  /**
   * Incorrect-phrase redemption records for this session. Retained for the
   * full session lifetime (including fully-resolved records) so the history
   * sidebar and future analytics can always access the complete resolution
   * trail. Optional for backward compatibility with older checkpoints.
   */
  incorrectPhraseRecords: z.array(incorrectPhraseRecordSchema).optional(),
});

export type SessionCheckpointParsed = z.infer<typeof sessionCheckpointSchema>;
