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

export async function fetchCourseLevelIdBySlug(
  slug: string,
): Promise<string | null> {
  const normalized = slug.trim();
  if (!normalized) return null;
  const { url, serviceRoleKey } = requireSupabaseEnv();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from('course_levels')
    .select('id')
    .eq('slug', normalized)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data?.id || typeof data.id !== 'string') {
    return null;
  }
  return data.id;
}

export interface LessonCatalogMetaForExport {
  title: string;
  description: string;
  sort_order: number;
  course_level_slug: string;
}

/**
 * Loads catalog row + course level slug for pull/export wrapped lesson files.
 */
export async function fetchLessonCatalogMeta(
  lessonId: string,
): Promise<LessonCatalogMetaForExport | null> {
  const { url, serviceRoleKey } = requireSupabaseEnv();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from('lesson_catalog')
    .select('title, description, sort_order, course_levels(slug)')
    .eq('lesson_id', lessonId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) return null;
  const row = data as {
    title: string;
    description: string;
    sort_order: number;
    course_levels: { slug: string } | { slug: string }[] | null;
  };
  const nested = row.course_levels;
  const slug =
    nested == null
      ? null
      : Array.isArray(nested)
        ? nested[0]?.slug
        : nested.slug;
  if (typeof slug !== 'string' || slug.length === 0) {
    return null;
  }
  return {
    title: row.title,
    description: row.description ?? '',
    sort_order: row.sort_order,
    course_level_slug: slug,
  };
}

export async function upsertLessonCatalogRow(params: {
  lessonId: string;
  courseLevelId: string;
  title: string;
  description: string;
  sortOrder: number;
}): Promise<void> {
  const { url, serviceRoleKey } = requireSupabaseEnv();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from('lesson_catalog').upsert(
    {
      lesson_id: params.lessonId,
      course_level_id: params.courseLevelId,
      title: params.title,
      description: params.description,
      sort_order: params.sortOrder,
    },
    { onConflict: 'lesson_id' },
  );
  if (error) {
    throw new Error(error.message);
  }
}
