import type { LearnerQuestionRequestBody } from "@ai-spanish/logic";
import { supabase } from "../lib/supabase";

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN;

/**
 * Posts a learner question to the web app's streaming route and returns the
 * raw ReadableStream for the shared hook to consume.
 *
 * Mirrors the pattern from `sessionHistory.service.ts`:
 * - Reads the web origin from EXPO_PUBLIC_WEB_ORIGIN.
 * - Attaches the Supabase bearer token for auth.
 * - Forwards the AbortSignal so the underlying fetch is cancelled when the
 *   hook aborts (phrase change / screen unmount).
 *
 * Relies on RN 0.76 + Hermes native ReadableStream / TextDecoder support.
 */
export async function postLearnerQuestion(
  body: LearnerQuestionRequestBody,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  if (!WEB_ORIGIN) {
    throw new Error(
      "[learnerQuestion] EXPO_PUBLIC_WEB_ORIGIN is not set — cannot reach the question API.",
    );
  }

  const url = `${WEB_ORIGIN.replace(/\/$/, "")}/api/learner-question`;

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
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      text || `Learner question request failed with status ${response.status}`,
    );
  }

  if (!response.body) {
    throw new Error("No response body received from learner question API");
  }

  return response.body;
}
