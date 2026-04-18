"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queryKeys } from "../services/query-keys";
import {
  fetchTranscript,
  type TranscriptResponse,
} from "../services/transcript.service";

/**
 * Loads transcript phrases for the lesson flow.
 */
export const useTranscriptQuery = (): UseQueryResult<TranscriptResponse> =>
  useQuery({
    queryKey: queryKeys.transcript,
    queryFn: fetchTranscript,
  });
