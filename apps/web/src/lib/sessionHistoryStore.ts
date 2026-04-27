/**
 * Dev telemetry buffer — in-memory per-lesson store for session history
 * entries posted by the mobile app during local development.
 *
 * IMPORTANT: This data is ephemeral and per-process. It is lost on cold start
 * and is not shared across multiple server instances. It is intended solely for
 * developer use while running `next dev`; the API routes that write/read this
 * store return 404 in production (NODE_ENV !== 'development').
 */

import type { HistoryEntryParsed, SessionCheckpointParsed } from '@ai-spanish/logic';

const entryStore = new Map<string, HistoryEntryParsed[]>();
const checkpointStore = new Map<string, SessionCheckpointParsed>();

export function appendSessionHistoryEntry(
  lessonId: string,
  entry: HistoryEntryParsed,
): void {
  const existing = entryStore.get(lessonId);
  if (existing) {
    existing.push(entry);
  } else {
    entryStore.set(lessonId, [entry]);
  }
}

/** Returns a copy of the stored entries for a lesson (empty array if none). */
export function getLessonHistory(lessonId: string): HistoryEntryParsed[] {
  return [...(entryStore.get(lessonId) ?? [])];
}

export function setLatestCheckpoint(
  lessonId: string,
  checkpoint: SessionCheckpointParsed,
): void {
  checkpointStore.set(lessonId, checkpoint);
}

/** Returns the last checkpoint posted for this lesson, or `null` if none. */
export function getLatestCheckpoint(
  lessonId: string,
): SessionCheckpointParsed | null {
  return checkpointStore.get(lessonId) ?? null;
}

export function clearLessonHistory(lessonId: string): void {
  entryStore.delete(lessonId);
  checkpointStore.delete(lessonId);
}

export function clearAllSessionHistory(): void {
  entryStore.clear();
  checkpointStore.clear();
}
