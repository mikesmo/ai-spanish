import { transcriptPathWithLesson } from "@ai-spanish/logic";
import {
  transcriptResponseSchema,
  type TranscriptResponse,
} from "./schemas/transcript.schema";
import { supabase } from "../lib/supabase";

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN;

/**
 * Fetches transcript phrases from the web app's API endpoint.
 * Sends `Authorization: Bearer` when the user has a Supabase session (required for `/api/transcript`).
 */
export const fetchTranscript = async (
  lessonId: string,
): Promise<TranscriptResponse> => {
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

  const path = transcriptPathWithLesson(lessonId);
  const response = await fetch(`${WEB_ORIGIN.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to load transcript: ${response.status}`);
  }

  const payload: unknown = await response.json();
  return transcriptResponseSchema.parse(payload);
};

export type { TranscriptResponse } from "./schemas/transcript.schema";
