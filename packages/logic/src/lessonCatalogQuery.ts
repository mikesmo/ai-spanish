import type { LessonsApiResponse } from './schemas/lessonCatalogApi';

/**
 * React Query key prefix for GET /api/lessons. Include course level slug so
 * caches stay scoped per tier.
 */
export const LESSONS_QUERY_KEY_PREFIX = 'lessons' as const;

export function lessonsQueryKey(
  courseLevelSlug: string,
): readonly [typeof LESSONS_QUERY_KEY_PREFIX, string] {
  return [LESSONS_QUERY_KEY_PREFIX, courseLevelSlug];
}

/**
 * `useQuery` options for lesson list (web + mobile share key + shape).
 */
export function createLessonsQueryOptions(
  courseLevelSlug: string,
  queryFn: () => Promise<LessonsApiResponse>,
): {
  queryKey: ReturnType<typeof lessonsQueryKey>;
  queryFn: () => Promise<LessonsApiResponse>;
} {
  return {
    queryKey: lessonsQueryKey(courseLevelSlug),
    queryFn,
  };
}
