import { useQuery } from "@tanstack/react-query";
import {
  sessionHistoryGetResponseSchema,
  type SessionHistoryGetResponse,
} from "@ai-spanish/logic";

async function fetchSessionHistory(lessonId: string): Promise<SessionHistoryGetResponse> {
  const res = await fetch(
    `/api/session-history?lesson=${encodeURIComponent(lessonId)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch session history: ${res.status}`);
  }
  const json: unknown = await res.json();
  return sessionHistoryGetResponseSchema.parse(json);
}

export function useMobileSessionLogQuery(lessonId: string) {
  return useQuery({
    queryKey: ["mobile-session-log", lessonId],
    queryFn: () => fetchSessionHistory(lessonId),
    refetchInterval: 2000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
