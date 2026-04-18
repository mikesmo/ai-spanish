"use client";

import {
  useMutation,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  requestTextToSpeech,
  type TextToSpeechRequest,
} from "../services/text-to-speech.service";

/**
 * Creates speech audio from text using the server TTS endpoint.
 */
export const useTextToSpeechMutation = (): UseMutationResult<
  Blob,
  Error,
  TextToSpeechRequest
> =>
  useMutation({
    mutationFn: requestTextToSpeech,
  });
