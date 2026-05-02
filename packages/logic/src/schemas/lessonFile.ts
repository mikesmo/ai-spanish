import { z } from 'zod';

import { isTranscriptLessonIdSyntaxValid } from '../lessonCatalog';
import { transcriptResponseSchema } from './phrase';

/**
 * Catalog + lesson id block in on-disk lesson JSON (`input/lessons/<id>.json`).
 */
export const lessonFileMetaSchema = z.object({
  lessonId: z
    .string()
    .refine(
      (id) => isTranscriptLessonIdSyntaxValid(id),
      'meta.lessonId must be a positive integer string without leading zeros',
    ),
  sortOrder: z.number().int(),
  title: z.string().min(1),
  description: z.string(),
  courseLevelSlug: z.string().min(1).optional(),
});

export const lessonFileSchema = z.object({
  meta: lessonFileMetaSchema,
  phrases: transcriptResponseSchema,
});

export type LessonFileMeta = z.infer<typeof lessonFileMetaSchema>;
export type LessonFile = z.infer<typeof lessonFileSchema>;

/**
 * Parses root JSON for push/pull tooling. Rejects legacy bare phrase arrays.
 */
export function parseLessonFileJson(raw: unknown, fileLabel: string): LessonFile {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `[lesson file] ${fileLabel}: expected root object with "meta" and "phrases", not a bare array`,
    );
  }
  const record = raw as Record<string, unknown>;
  if (!('meta' in record) || !('phrases' in record)) {
    throw new Error(
      `[lesson file] ${fileLabel}: expected keys "meta" and "phrases" on root object`,
    );
  }
  const result = lessonFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `[lesson file] ${fileLabel}: validation failed — ${JSON.stringify(result.error.flatten())}`,
    );
  }
  return result.data;
}
