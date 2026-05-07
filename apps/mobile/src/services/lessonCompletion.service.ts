import {
  deleteLessonProgress,
  type LessonSessionCompletionPayload,
} from "@ai-spanish/logic";
import { supabase } from "../lib/supabase";
import { mobileLessonProgressFetcher } from "./lessonProgressTransport";

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN;

/**
 * Posts a completed lesson snapshot to the web API and, on success, deletes
 * the in-progress checkpoint row so the next session starts fresh.
 *
 * Returns `true` when the server accepted the completion (2xx).
 */
export async function postLessonCompletion(
  payload: LessonSessionCompletionPayload,
  lessonId: string,
): Promise<boolean> {
  if (!WEB_ORIGIN) {
    console.warn(
      "[lessonCompletion] EXPO_PUBLIC_WEB_ORIGIN is not set — cannot save completion.",
    );
    return false;
  }

  const url = `${WEB_ORIGIN.replace(/\/$/, "")}/api/lesson-completions`;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (supabase) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ payload }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn(
        `[lessonCompletion] POST failed ${response.status}`,
        text.slice(0, 200),
      );
      return false;
    }

    // Clear the in-progress row so the next session starts fresh.
    const delOk = await deleteLessonProgress(mobileLessonProgressFetcher, lessonId);
    if (!delOk) {
      console.warn("[lessonCompletion] failed to clear in-progress checkpoint");
    }

    return true;
  } catch (err) {
    console.warn("[lessonCompletion] POST error", err);
    return false;
  }
}
