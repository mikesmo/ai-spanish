/**
 * Dev telemetry buffer — in-memory per-lesson store for session history
 * entries posted by the mobile app during local development.
 *
 * IMPORTANT: This data is ephemeral and per-process. It is lost on cold start
 * and is not shared across multiple server instances. It is intended solely for
 * developer use while running `next dev`; the API routes that write/read this
 * store return 404 in production (NODE_ENV !== 'development').
 */

import type { HistoryEntryParsed } from '@ai-spanish/logic';

const store = new Map<string, HistoryEntryParsed[]>();

export function appendSessionHistoryEntry(
  lessonId: string,
  entry: HistoryEntryParsed,
): void {
  const existing = store.get(lessonId);
  if (existing) {
    existing.push(entry);
  } else {
    store.set(lessonId, [entry]);
  }
}

/** Returns a copy of the stored entries for a lesson (empty array if none). */
export function getLessonHistory(lessonId: string): HistoryEntryParsed[] {
  return [...(store.get(lessonId) ?? [])];
}

export function clearLessonHistory(lessonId: string): void {
  store.delete(lessonId);
}

export function clearAllSessionHistory(): void {
  store.clear();
}
