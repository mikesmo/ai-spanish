import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getLessonTranscriptDbEnv } from './lesson-transcript-repository';

export interface CourseLevelRow {
  id: string;
  slug: string;
  title: string;
  sort_order: number;
}

export interface LessonCatalogRow {
  lesson_id: string;
  title: string;
  description: string;
  sort_order: number;
}

function createServiceRoleClient(): SupabaseClient {
  const env = getLessonTranscriptDbEnv();
  if (!env) {
    throw new Error(
      'Catalog reads require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Fetches ordered lesson catalog entries for a course level slug (authenticated BFF only).
 */
export async function fetchLessonCatalogByCourseLevelSlug(
  slug: string,
): Promise<
  | { ok: true; courseLevel: CourseLevelRow; lessons: LessonCatalogRow[] }
  | { ok: false; reason: 'not_found' | 'db_error'; message: string }
> {
  const normalized = slug.trim();
  if (!normalized) {
    return { ok: false, reason: 'not_found', message: 'Empty course level' };
  }

  const supabase = createServiceRoleClient();
  const { data: level, error: levelError } = await supabase
    .from('course_levels')
    .select('id, slug, title, sort_order')
    .eq('slug', normalized)
    .maybeSingle();

  if (levelError) {
    return {
      ok: false,
      reason: 'db_error',
      message: levelError.message,
    };
  }
  if (!level) {
    return { ok: false, reason: 'not_found', message: 'Course level not found' };
  }

  const { data: lessons, error: lessonsError } = await supabase
    .from('lesson_catalog')
    .select('lesson_id, title, description, sort_order')
    .eq('course_level_id', level.id)
    .order('sort_order', { ascending: true });

  if (lessonsError) {
    return {
      ok: false,
      reason: 'db_error',
      message: lessonsError.message,
    };
  }

  return {
    ok: true,
    courseLevel: level as CourseLevelRow,
    lessons: (lessons ?? []) as LessonCatalogRow[],
  };
}
