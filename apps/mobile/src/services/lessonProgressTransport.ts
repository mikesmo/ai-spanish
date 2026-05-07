import type { LessonProgressFetcher } from "@ai-spanish/logic";
import { supabase } from "../lib/supabase";

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN;

/**
 * Mobile HTTP transport for the lesson-progress API.
 *
 * Resolves relative `/api/...` paths against `EXPO_PUBLIC_WEB_ORIGIN` and
 * attaches a Supabase Bearer token, matching the pattern used by other mobile
 * API services in this app.
 */
export const mobileLessonProgressFetcher: LessonProgressFetcher = async (
  path: string,
  init: RequestInit,
): Promise<Response> => {
  if (!WEB_ORIGIN) {
    throw new Error(
      "[lessonProgress] EXPO_PUBLIC_WEB_ORIGIN is not set — cannot reach lesson-progress API.",
    );
  }

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };

  if (supabase) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  }

  const url = `${WEB_ORIGIN.replace(/\/$/, "")}${path}`;
  return fetch(url, { ...init, headers });
};
