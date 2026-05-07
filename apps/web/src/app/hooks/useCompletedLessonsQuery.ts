"use client";

import {
  completedLessonsListResponseSchema,
  type CompletedLessonsListResponse,
} from "@ai-spanish/logic";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

export const COMPLETED_LESSONS_QUERY_KEY = ["lesson-completions", "list"] as const;

const fetchCompletedLessons = async (): Promise<CompletedLessonsListResponse> => {
  const response = await fetch("/api/lesson-completions", {
    credentials: "include",
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const err =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "Failed to load completed lessons";
    throw new Error(err);
  }

  return completedLessonsListResponseSchema.parse(payload);
};

/**
 * Fetches the set of lesson IDs the authenticated user has at least one
 * completion for. Used by the home page to decide whether to show the
 * Report link beside each lesson card.
 */
export const useCompletedLessonsQuery = (): UseQueryResult<
  CompletedLessonsListResponse
> =>
  useQuery({
    queryKey: COMPLETED_LESSONS_QUERY_KEY,
    queryFn: fetchCompletedLessons,
    staleTime: 30_000,
  });
