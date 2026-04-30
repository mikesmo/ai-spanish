import { createClient } from '@supabase/supabase-js';

import { transcriptResponseSchema } from '@ai-spanish/logic';

function requireSupabaseEnv(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Push transcripts requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return { url, serviceRoleKey };
}

/**
 * Validates phrases with {@link transcriptResponseSchema} and upserts `lesson_transcripts`.
 */
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
  if (error) {
    throw new Error(error.message);
  }
}
