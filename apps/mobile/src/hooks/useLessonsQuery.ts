import {
  createLessonsQueryOptions,
  DEFAULT_COURSE_LEVEL_SLUG,
  type LessonsApiResponse,
} from "@ai-spanish/logic";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { fetchLessonsCatalog } from "../services/lessons.service";

export const useLessonsQuery = (
  courseLevelSlug: string = DEFAULT_COURSE_LEVEL_SLUG,
): UseQueryResult<LessonsApiResponse> =>
  useQuery(
    createLessonsQueryOptions(courseLevelSlug, () =>
      fetchLessonsCatalog(courseLevelSlug),
    ),
  );
