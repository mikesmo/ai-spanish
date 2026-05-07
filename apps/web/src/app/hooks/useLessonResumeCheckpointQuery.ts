'use client';

import {
  buildDeckFingerprint,
  sessionCheckpointSchema,
  type Phrase,
  type SessionCheckpointParsed,
} from '@ai-spanish/logic';
import { useQuery } from '@tanstack/react-query';

/**
 * Loads the last persisted in-progress checkpoint for resume (authenticated).
 */
export function useLessonResumeCheckpointQuery(
  lessonId: string,
  phrases: Phrase[] | undefined,
) {
  const phrasesReady = Boolean(phrases && phrases.length > 0);

  return useQuery({
    queryKey: ['lesson-resume-checkpoint', lessonId],
    enabled: phrasesReady,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async (): Promise<SessionCheckpointParsed | undefined> => {
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
      if (
        checkpointUnknown === undefined ||
        checkpointUnknown === null
      ) {
        return undefined;
      }
      const parsed = sessionCheckpointSchema.safeParse(checkpointUnknown);
      if (!parsed.success) {
        return undefined;
      }
      const cp = parsed.data;

      if (cp.deckFingerprint !== undefined && phrases != null) {
        const fp = buildDeckFingerprint(phrases);
        if (cp.deckFingerprint !== fp) {
          return undefined;
        }
      }

      return cp;
    },
    retry: false,
  });
}
