import { createClient } from '@supabase/supabase-js';

import type { Phrase } from '@ai-spanish/logic';
import { transcriptResponseSchema } from '@ai-spanish/logic';

export function requireSupabaseEnv(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return { url, serviceRoleKey };
}

export async function fetchLessonPhrasesJson(lessonId: string): Promise<unknown> {
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
    throw new Error(`No transcript for lesson_id=${lessonId}`);
  }
  return data.phrases;
}

export interface LessonTranscriptRow {
  lesson_id: string;
  phrases: unknown;
}

export async function fetchAllLessonTranscripts(): Promise<LessonTranscriptRow[]> {
  const { url, serviceRoleKey } = requireSupabaseEnv();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from('lesson_transcripts')
    .select('lesson_id, phrases');
  if (error) {
    throw new Error(error.message);
  }
  if (!data?.length) {
    return [];
  }
  return data.map((row): LessonTranscriptRow => {
    if (typeof row.lesson_id !== 'string' || row.lesson_id.length === 0) {
      throw new Error('lesson_transcripts row missing lesson_id');
    }
    return { lesson_id: row.lesson_id, phrases: row.phrases };
  });
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
  if (error) {
    throw new Error(error.message);
  }
}

/** Validates and returns `Phrase[]` from `lesson_transcripts` (service role). */
export async function loadTranscriptPhrasesFromSupabase(
  lessonId: string,
): Promise<Phrase[]> {
  const raw = await fetchLessonPhrasesJson(lessonId);
  return transcriptResponseSchema.parse(raw);
}
