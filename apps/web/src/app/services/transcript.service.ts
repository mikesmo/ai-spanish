import {
  transcriptResponseSchema,
  type TranscriptResponse,
} from "./schemas/transcript.schema";
export type { TranscriptResponse } from "./schemas/transcript.schema";

/**
 * Fetches transcript phrases from the server API.
 */
export const fetchTranscript = async (): Promise<TranscriptResponse> => {
  const response = await fetch("/api/transcript");
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error("Failed to load transcript");
  }

  return transcriptResponseSchema.parse(payload);
};
