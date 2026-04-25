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
