import {
  transcriptResponseSchema,
  type TranscriptResponse,
} from "./schemas/transcript.schema";

const transcriptJson = require("../../assets/transcript.json") as unknown;

/**
 * Loads the transcript bundled with the app and validates it at the boundary.
 */
export const fetchTranscript = async (): Promise<TranscriptResponse> =>
  transcriptResponseSchema.parse(transcriptJson);

export type { TranscriptResponse } from "./schemas/transcript.schema";
