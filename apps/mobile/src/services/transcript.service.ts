import {
  transcriptResponseSchema,
  type TranscriptResponse,
} from "./schemas/transcript.schema";

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN;

/**
 * Fetches transcript phrases from the web app's API endpoint.
 * Requires EXPO_PUBLIC_WEB_ORIGIN to be set (e.g. http://localhost:3000 for
 * local dev, or the production URL when deployed).
 */
export const fetchTranscript = async (): Promise<TranscriptResponse> => {
  if (!WEB_ORIGIN) {
    throw new Error(
      "EXPO_PUBLIC_WEB_ORIGIN is not set. Add it to your .env file."
    );
  }

  const response = await fetch(`${WEB_ORIGIN}/api/transcript`);

  if (!response.ok) {
    throw new Error(`Failed to load transcript: ${response.status}`);
  }

  const payload: unknown = await response.json();
  return transcriptResponseSchema.parse(payload);
};

export type { TranscriptResponse } from "./schemas/transcript.schema";
