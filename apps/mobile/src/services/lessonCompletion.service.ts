import type { LessonSessionCompletionPayload } from "@ai-spanish/logic";
import { supabase } from "../lib/supabase";

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN;

/**
 * Posts a completed lesson snapshot to the web API (same auth as other
 * cross-origin calls). Safe to call from production when the web app is
 * deployed; failures are non-fatal.
 */
export async function postLessonCompletion(
  payload: LessonSessionCompletionPayload,
): Promise<void> {
  if (!WEB_ORIGIN) {
    console.warn(
      "[lessonCompletion] EXPO_PUBLIC_WEB_ORIGIN is not set — cannot save completion.",
    );
    return;
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
    }
  } catch (err) {
    console.warn("[lessonCompletion] POST error", err);
  }
}
