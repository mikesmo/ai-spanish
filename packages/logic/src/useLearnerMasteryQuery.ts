'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearnerMasterySnapshot } from './schemas/learnerMastery';
import { fetchLearnerMasterySnapshot } from './learnerMasteryClient';
import type { LessonProgressFetcher } from './lessonProgressClient';

/**
 * Loads the learner's lifetime word/grammar mastery snapshot, used to seed a
 * new lesson session (`useLessonSession`'s `initialItemScores`).
 *
 * Runs in parallel with the lesson transcript + resume-checkpoint fetches —
 * the host must wait for a real round-trip (mirrors
 * `useLessonResumeCheckpointQuery`) since `useLessonSession` only reads its
 * seed once via `useRef` at mount.
 */
export function useLearnerMasteryQuery(
  fetcher: LessonProgressFetcher,
): UseQueryResult<LearnerMasterySnapshot> {
  return useQuery({
    queryKey: ['learner-mastery'],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: (): Promise<LearnerMasterySnapshot> => fetchLearnerMasterySnapshot(fetcher),
    retry: false,
  });
}
