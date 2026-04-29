import type { Phrase } from '@ai-spanish/logic';

import { fetchLessonTranscriptPhrases } from '@/server/lesson-transcript-repository';

const VALID_LESSON_IDS = new Set(['1', '2']);
const DEFAULT_LESSON = '1';

/** Resolves validated lesson id (matches `/api/transcript` behavior). */
export function resolveLessonIdForFiles(raw: string | null | undefined): string {
  const s = raw?.trim() ?? '';
  if (s === '' || !VALID_LESSON_IDS.has(s)) {
    return DEFAULT_LESSON;
  }
  return s;
}

/**
 * Loads parsed lesson transcript phrases from Supabase `lesson_transcripts`.
 */
export async function loadLessonTranscript(
  lessonIdRaw: string | null | undefined,
): Promise<Phrase[]> {
  const canonical = resolveLessonIdForFiles(lessonIdRaw ?? '');
  return fetchLessonTranscriptPhrases(canonical);
}
