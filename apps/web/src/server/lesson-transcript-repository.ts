import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Phrase } from '@ai-spanish/logic';
import { transcriptResponseSchema } from '@ai-spanish/logic';

/**
 * Env required for server-side transcript reads/writes against `lesson_transcripts` (service role bypasses RLS for BFF + scripts).
 */
export function getLessonTranscriptDbEnv(): {
  url: string;
  serviceRoleKey: string;
} | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

function createServiceRoleClient(): SupabaseClient {
  const env = getLessonTranscriptDbEnv();
  if (!env) {
    throw new Error(
      'Transcript storage requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Loads validated phrases for a canonical transcript lesson id (`1` or `2`).
 */
export async function fetchLessonTranscriptPhrases(
  lessonId: string,
): Promise<Phrase[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('lesson_transcripts')
    .select('phrases')
    .eq('lesson_id', lessonId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data?.phrases) {
    throw new Error(`No transcript found for lesson ${lessonId}`);
  }

  const parsed = transcriptResponseSchema.safeParse(data.phrases);
  if (!parsed.success) {
    throw new Error('Stored transcript failed validation');
  }
  return parsed.data;
}

/**
 * Replaces transcript payload for a lesson (`phrases` must already satisfy `transcriptResponseSchema`).
 */
export async function upsertLessonTranscriptPhrases(
  lessonId: string,
  phrases: Phrase[],
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('lesson_transcripts').upsert(
    { lesson_id: lessonId, phrases },
    { onConflict: 'lesson_id' },
  );
  if (error) {
    throw new Error(error.message);
  }
}
