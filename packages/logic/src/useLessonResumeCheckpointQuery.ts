'use client';

import { useQuery } from '@tanstack/react-query';
import type { SessionCheckpointParsed } from './schemas/sessionCheckpoint';
import {
  fetchLessonResumeCheckpoint,
  type LessonProgressFetcher,
} from './lessonProgressClient';

/**
 * Loads the last persisted in-progress checkpoint for resume.
 *
 * The `fetcher` argument provides the platform-specific transport (cookie-auth
 * on web, Bearer-token on mobile). Runs in parallel with the lesson transcript
 * fetch — the consumer validates the checkpoint against the loaded deck
 * (fingerprint check) once both queries resolve.
 *
 * Returns `null` when there is no resumable checkpoint (deleted, never saved,
 * or unparseable). React Query v5 forbids `undefined` as query data.
 */
export function useLessonResumeCheckpointQuery(
  fetcher: LessonProgressFetcher,
  lessonId: string,
) {
  return useQuery({
    queryKey: ['lesson-resume-checkpoint', lessonId],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: (): Promise<SessionCheckpointParsed | null> =>
      fetchLessonResumeCheckpoint(fetcher, lessonId),
    retry: false,
  });
}
