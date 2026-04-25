import { TRANSCRIPT_QUERY_KEY } from "@ai-spanish/logic";

export const queryKeys = {
  transcript: TRANSCRIPT_QUERY_KEY,
  authenticate: ["authenticate"] as const,
  textToSpeech: ["text-to-speech"] as const,
};
