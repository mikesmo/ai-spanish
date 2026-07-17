'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CefrLevel } from './schemas';
import { fetchDeclaredLevel } from './cefrLevelClient';
import type { LessonProgressFetcher } from './lessonProgressClient';

export const DECLARED_LEVEL_QUERY_KEY = ['learner-level'] as const;

/** Loads the authenticated user's self-declared CEFR level for the Settings picker. */
export function useDeclaredLevelQuery(
  fetcher: LessonProgressFetcher,
): UseQueryResult<CefrLevel | null> {
  return useQuery({
    queryKey: DECLARED_LEVEL_QUERY_KEY,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: (): Promise<CefrLevel | null> => fetchDeclaredLevel(fetcher),
  });
}
