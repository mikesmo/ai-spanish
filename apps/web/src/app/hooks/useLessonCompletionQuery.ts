"use client";

import {
  sessionHistoryGetResponseSchema,
  type SessionHistoryGetResponse,
} from "@ai-spanish/logic";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

export const lessonCompletionQueryKey = (lessonId: string) =>
  ["lesson-completions", "detail", lessonId] as const;

const fetchLessonCompletion = async (
  lessonId: string,
): Promise<SessionHistoryGetResponse> => {
  const response = await fetch(
    `/api/lesson-completions?lesson=${encodeURIComponent(lessonId)}`,
    { credentials: "include" },
  );
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const err =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "Failed to load lesson completion";
    throw new Error(err);
  }

  return sessionHistoryGetResponseSchema.parse(payload);
};

/**
 * Loads the latest stored lesson completion for the signed-in user. Returns
 * `entries: []` when no completion exists yet (the API normalizes this).
 */
export const useLessonCompletionQuery = (
  lessonId: string,
): UseQueryResult<SessionHistoryGetResponse> =>
  useQuery({
    queryKey: lessonCompletionQueryKey(lessonId),
    queryFn: () => fetchLessonCompletion(lessonId),
    enabled: lessonId.length > 0,
    staleTime: 30_000,
  });
