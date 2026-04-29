import { createClient } from '@supabase/supabase-js';

import type { Phrase } from '@ai-spanish/logic';
import { transcriptResponseSchema } from '../../../packages/logic/src/schemas/phrase.js';

function requireSupabaseEnv(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Supabase transcript load requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return { url, serviceRoleKey };
}

/** Loads `Phrase[]` from `public.lesson_transcripts` (service role). */
export async function loadTranscriptFromSupabase(lessonId: string): Promise<Phrase[]> {
  const { url, serviceRoleKey } = requireSupabaseEnv();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from('lesson_transcripts')
    .select('phrases')
    .eq('lesson_id', lessonId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data?.phrases) {
    throw new Error(`No transcript row for lesson_id=${lessonId}`);
  }

  return transcriptResponseSchema.parse(data.phrases);
}
