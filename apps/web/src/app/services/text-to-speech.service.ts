import {
  textToSpeechErrorSchema,
  type TextToSpeechError,
} from "./schemas/text-to-speech.schema";

export type TtsProvider = "deepgram" | "google" | "murf";
export type TtsLanguage = "es" | "en";

export interface TextToSpeechRequest {
  text: string;
  provider?: TtsProvider;
  language?: TtsLanguage;
}

/**
 * Sends text to the TTS endpoint and returns playable audio data.
 */
export const requestTextToSpeech = async (
  request: TextToSpeechRequest,
): Promise<Blob> => {
  const response = await fetch("/api/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const payload: unknown = await response.json();
    const parsedError: TextToSpeechError = textToSpeechErrorSchema.parse(payload);
    throw new Error(parsedError.error);
  }

  return response.blob();
};
