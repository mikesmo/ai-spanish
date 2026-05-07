import { useQuery } from "@tanstack/react-query";
import {
  sessionHistoryGetResponseSchema,
  type SessionHistoryGetResponse,
} from "@ai-spanish/logic";

async function fetchLatestLessonCompletion(
  lessonId: string,
): Promise<SessionHistoryGetResponse> {
  const res = await fetch(
    `/api/lesson-completions?lesson=${encodeURIComponent(lessonId)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch session history: ${res.status}`);
  }
  const json: unknown = await res.json();
  return sessionHistoryGetResponseSchema.parse(json);
}

export function useMobileSessionLogQuery(lessonId: string) {
  return useQuery({
    queryKey: ["lesson-completion-log", lessonId],
    queryFn: () => fetchLatestLessonCompletion(lessonId),
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
