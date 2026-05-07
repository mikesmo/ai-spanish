'use client';

import {
  sessionCheckpointSchema,
  type SessionCheckpointParsed,
} from '@ai-spanish/logic';
import { useQuery } from '@tanstack/react-query';

/**
 * Loads the last persisted in-progress checkpoint for resume (authenticated).
 *
 * Runs in parallel with the lesson transcript fetch — the consumer is
 * responsible for validating the checkpoint against the loaded deck
 * (fingerprint check) once both queries resolve.
 *
 * Returns `null` when there is no resumable checkpoint (deleted, never saved,
 * or unparseable). React Query v5 forbids `undefined` as query data.
 */
export function useLessonResumeCheckpointQuery(lessonId: string) {
  return useQuery({
    queryKey: ['lesson-resume-checkpoint', lessonId],
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async (): Promise<SessionCheckpointParsed | null> => {
      const res = await fetch(
        `/api/lesson-progress?lesson=${encodeURIComponent(lessonId)}`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        throw new Error(`lesson-progress GET failed: ${res.status}`);
      }
      const json: unknown = await res.json();
      const checkpointUnknown =
        typeof json === 'object' && json !== null && 'checkpoint' in json
          ? (json as { checkpoint: unknown }).checkpoint
          : undefined;
      if (checkpointUnknown === undefined || checkpointUnknown === null) {
        return null;
      }
      const parsed = sessionCheckpointSchema.safeParse(checkpointUnknown);
      if (!parsed.success) {
        return null;
      }
      return parsed.data;
    },
    retry: false,
  });
}
