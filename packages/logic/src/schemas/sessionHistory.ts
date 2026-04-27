import { z } from 'zod';
import { phraseSchema } from './phrase';

export const accuracyBreakdownSchema = z.object({
  accuracy: z.number(),
  totalWeight: z.number(),
  missingPenalty: z.number(),
  extraPenalty: z.number(),
  rawExtraPenalty: z.number(),
});

export const fluencyBreakdownSchema = z.object({
  speedScore: z.number(),
  pauseScore: z.number(),
  gapConsistencyScore: z.number(),
  fluencyScore: z.number(),
  wordsPerSecond: z.number(),
  longPauses: z.number(),
});

const attemptEventSchema = z.object({
  eventType: z.literal('attempt'),
  phraseId: z.string(),
  transcript: z.array(z.string()),
  missingWords: z.array(z.string()),
  extraWords: z.array(z.string()),
  accuracyScore: z.number(),
  fluencyScore: z.number().nullable(),
  spokenWordCount: z.number().optional(),
  isAccuracySuccess: z.boolean(),
  success: z.boolean(),
  timestamp: z.number(),
  accuracyBreakdown: accuracyBreakdownSchema,
  fluencyBreakdown: fluencyBreakdownSchema.nullable(),
});

const practiceEventSchema = z.object({
  eventType: z.literal('practice'),
  phraseId: z.string(),
  transcript: z.array(z.string()),
  fluencyScore: z.number().nullable(),
  timestamp: z.number(),
  accuracyBreakdown: accuracyBreakdownSchema,
  fluencyBreakdown: fluencyBreakdownSchema.nullable(),
});

const revealEventSchema = z.object({
  eventType: z.literal('reveal'),
  phraseId: z.string(),
  penaltyApplied: z.literal(true),
  timestamp: z.number(),
});

export const phraseEventSchema = z.discriminatedUnion('eventType', [
  attemptEventSchema,
  practiceEventSchema,
  revealEventSchema,
]);

export const scoreSummarySchema = z.object({
  accuracy: z.number(),
  fluency: z.number().nullable(),
  mastery: z.number(),
  isAccuracySuccess: z.boolean(),
});

export const stabilityBreakdownSchema = z.object({
  before: z.number(),
  after: z.number(),
  kind: z.enum(['attempt_ema', 'reveal_decay', 'practice_unchanged']),
  emaInput: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const historyEntrySchema = z.object({
  id: z.string(),
  event: phraseEventSchema,
  phrase: phraseSchema,
  scoreSummary: scoreSummarySchema.nullable(),
  stabilityBreakdown: stabilityBreakdownSchema,
  masteryBefore: z.number(),
  masteryAfter: z.number(),
  isRepeatedPresentation: z.boolean(),
  dueOnLessonSessionIndex: z.number(),
  slotsAheadAtEvent: z.number().nullable(),
});

export type HistoryEntryParsed = z.infer<typeof historyEntrySchema>;

export const sessionHistoryGetResponseSchema = z.object({
  lessonId: z.string(),
  entries: z.array(historyEntrySchema),
});

export type SessionHistoryGetResponse = z.infer<
  typeof sessionHistoryGetResponseSchema
>;
