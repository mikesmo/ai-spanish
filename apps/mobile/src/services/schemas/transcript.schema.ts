import { z } from "zod";

export const phraseSchema = z.object({
  English: z.object({
    intro: z.string(),
    question: z.string(),
  }),
  Spanish: z.object({
    grammar: z.string(),
    answer: z.string(),
  }),
});

export const transcriptResponseSchema = z.array(phraseSchema);

export type TranscriptResponse = z.infer<typeof transcriptResponseSchema>;
