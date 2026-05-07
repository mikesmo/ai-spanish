import type { LessonSessionCompletionPayload } from './schemas/lessonSessionCompletion';
import { lessonSessionCompletionPayloadSchema } from './schemas/lessonSessionCompletion';
import type { SessionCheckpointParsed } from './schemas/sessionCheckpoint';
import type { HistoryEntry } from './useSessionHistory';

/** Client-generated idempotency key for one mounted lesson attempt. */
export function createLessonCompletionRunId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Builds the JSON persisted at lesson completion (`isComplete`).
 * Callers generate and reuse a stable {@link LessonSessionCompletionPayload.runId}.
 */
export function buildLessonCompletionPayload(args: {
  runId: string;
  lessonId: string;
  lessonTitle?: string;
  completedAtMs?: number;
  entries: readonly HistoryEntry[];
  checkpoint: SessionCheckpointParsed;
}): LessonSessionCompletionPayload {
  return lessonSessionCompletionPayloadSchema.parse({
    schemaVersion: 1,
    runId: args.runId,
    lessonId: args.lessonId,
    ...(args.lessonTitle !== undefined ? { lessonTitle: args.lessonTitle } : {}),
    completedAtMs: args.completedAtMs ?? Date.now(),
    entries: [...args.entries],
    checkpoint: args.checkpoint,
  });
}
