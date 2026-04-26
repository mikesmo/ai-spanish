"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createLessonTranscriptQueryOptions } from "@ai-spanish/logic";
import {
  fetchTranscript,
  type TranscriptResponse,
} from "../services/transcript.service";

/**
 * Loads transcript phrases for a specific lesson.
 */
export const useLessonQuery = (lessonId: string): UseQueryResult<TranscriptResponse> =>
  useQuery(
    createLessonTranscriptQueryOptions(lessonId, () => fetchTranscript(lessonId)),
  );
