import {
  DEFAULT_COURSE_LEVEL_SLUG,
  lessonsApiPath,
  lessonsApiResponseSchema,
  type LessonsApiResponse,
} from "@ai-spanish/logic";
import { supabase } from "../lib/supabase";

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN;

export type { LessonsApiResponse } from "@ai-spanish/logic";

/**
 * Fetches lesson list for a course level from the web app's API (Bearer auth).
 */
export const fetchLessonsCatalog = async (
  courseLevelSlug: string = DEFAULT_COURSE_LEVEL_SLUG,
): Promise<LessonsApiResponse> => {
  if (!WEB_ORIGIN) {
    throw new Error(
      "EXPO_PUBLIC_WEB_ORIGIN is not set. Add it to your .env file.",
    );
  }

  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not signed in.");
  }

  const path = lessonsApiPath(courseLevelSlug);
  const response = await fetch(`${WEB_ORIGIN.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const payload: unknown = await response.json();

  if (!response.ok) {
    const err =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Failed to load lessons: ${response.status}`;
    throw new Error(err);
  }

  return lessonsApiResponseSchema.parse(payload);
};
