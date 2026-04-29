import { createClient } from '@supabase/supabase-js';

import { transcriptResponseSchema } from '../../../packages/logic/src/schemas/phrase.js';

function requireSupabaseEnv(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error(
      'TRANSCRIPT_LESSON_ID mode requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return { url, serviceRoleKey };
}

export async function fetchLessonPhrasesJson(
  lessonId: string,
): Promise<unknown> {
  const { url, serviceRoleKey } = requireSupabaseEnv();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from('lesson_transcripts')
    .select('phrases')
    .eq('lesson_id', lessonId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.phrases) throw new Error(`No transcript for lesson_id=${lessonId}`);
  return data.phrases;
}

export async function upsertLessonPhrasesJson(
  lessonId: string,
  phrases: unknown,
): Promise<void> {
  const validated = transcriptResponseSchema.parse(phrases);
  const { url, serviceRoleKey } = requireSupabaseEnv();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from('lesson_transcripts').upsert(
    { lesson_id: lessonId, phrases: validated },
    { onConflict: 'lesson_id' },
  );
  if (error) throw new Error(error.message);
}
