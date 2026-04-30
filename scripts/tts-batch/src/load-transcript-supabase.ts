import type { Phrase } from '@ai-spanish/logic';

import { loadTranscriptPhrasesFromSupabase } from '../../lib/supabase-lesson-transcripts.js';

/** Loads `Phrase[]` from `public.lesson_transcripts` (service role). */
export async function loadTranscriptFromSupabase(lessonId: string): Promise<Phrase[]> {
  return loadTranscriptPhrasesFromSupabase(lessonId);
}
