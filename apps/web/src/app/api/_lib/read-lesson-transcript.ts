import { resolveTranscriptLessonQueryParam, type Phrase } from '@ai-spanish/logic';

import { fetchLessonTranscriptPhrases } from '@/server/lesson-transcript-repository';

/** Resolves validated lesson id (matches `/api/transcript` behavior). */
export function resolveLessonIdForFiles(raw: string | null | undefined): string {
  return resolveTranscriptLessonQueryParam(raw);
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
