"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  createTranscriptQueryOptions,
  DEFAULT_TRANSCRIPT_LESSON_ID,
} from "@ai-spanish/logic";
import {
  fetchTranscript,
  type TranscriptResponse,
} from "../services/transcript.service";

/**
 * Loads transcript phrases for the lesson flow.
 */
export const useTranscriptQuery = (): UseQueryResult<TranscriptResponse> =>
  useQuery(
    createTranscriptQueryOptions(() =>
      fetchTranscript(DEFAULT_TRANSCRIPT_LESSON_ID),
    ),
  );
