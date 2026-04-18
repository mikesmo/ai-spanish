import { z } from "zod";

export const textToSpeechErrorSchema = z.object({
  error: z.string(),
});

export type TextToSpeechError = z.infer<typeof textToSpeechErrorSchema>;
