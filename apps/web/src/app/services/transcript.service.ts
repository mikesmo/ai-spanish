import { transcriptPathWithLesson } from "@ai-spanish/logic";
import {
  transcriptResponseSchema,
  type TranscriptResponse,
} from "./schemas/transcript.schema";
export type { TranscriptResponse } from "./schemas/transcript.schema";

/**
 * Fetches transcript phrases from the server API for a given lesson.
 */
export const fetchTranscript = async (
  lessonId: string,
): Promise<TranscriptResponse> => {
  const response = await fetch(transcriptPathWithLesson(lessonId), {
    credentials: 'include',
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error("Failed to load transcript");
  }

  return transcriptResponseSchema.parse(payload);
};
