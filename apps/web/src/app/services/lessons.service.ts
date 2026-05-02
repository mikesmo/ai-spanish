import {
  DEFAULT_COURSE_LEVEL_SLUG,
  lessonsApiPath,
  lessonsApiResponseSchema,
  type LessonsApiResponse,
} from '@ai-spanish/logic';

export type { LessonsApiResponse } from '@ai-spanish/logic';

/**
 * Fetches lesson list for a course level from the authenticated web API.
 */
export const fetchLessonsCatalog = async (
  courseLevelSlug: string = DEFAULT_COURSE_LEVEL_SLUG,
): Promise<LessonsApiResponse> => {
  const response = await fetch(lessonsApiPath(courseLevelSlug), {
    credentials: 'include',
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const err =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'Failed to load lessons';
    throw new Error(err);
  }

  return lessonsApiResponseSchema.parse(payload);
};
