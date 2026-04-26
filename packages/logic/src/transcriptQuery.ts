import type { TranscriptResponse } from './schemas/phrase';

/**
 * React Query key for the lesson transcript fetch. Web and mobile must use the
 * same value so cache identity and invalidation stay aligned.
 */
export const TRANSCRIPT_QUERY_KEY = ['transcript'] as const;

/**
 * Build `useQuery` options for the lesson transcript. Apps supply the
 * environment-specific `fetchTranscript` (relative URL vs `EXPO_PUBLIC_WEB_ORIGIN`).
 */
export function createTranscriptQueryOptions(
  queryFn: () => Promise<TranscriptResponse>,
): {
  queryKey: typeof TRANSCRIPT_QUERY_KEY;
  queryFn: () => Promise<TranscriptResponse>;
} {
  return {
    queryKey: TRANSCRIPT_QUERY_KEY,
    queryFn,
  };
}

/**
 * React Query key prefix for per-lesson transcript fetches. Web and mobile must
 * use the same shape: `['transcript', lessonId]`.
 */
export const lessonTranscriptQueryKeyPrefix = 'transcript' as const;

export function lessonTranscriptQueryKey(lessonId: string): readonly [
  typeof lessonTranscriptQueryKeyPrefix,
  string,
] {
  return [lessonTranscriptQueryKeyPrefix, lessonId];
}

/**
 * `useQuery` options for a specific lesson transcript. Same factory for web
 * and mobile so cache identity matches.
 */
export function createLessonTranscriptQueryOptions(
  lessonId: string,
  queryFn: () => Promise<TranscriptResponse>,
): {
  queryKey: ReturnType<typeof lessonTranscriptQueryKey>;
  queryFn: () => Promise<TranscriptResponse>;
} {
  return {
    queryKey: lessonTranscriptQueryKey(lessonId),
    queryFn,
  };
}
