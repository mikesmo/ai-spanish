import { z } from 'zod';

export const lessonCatalogEntrySchema = z.object({
  lessonId: z.string(),
  title: z.string(),
  description: z.string(),
  sortOrder: z.number().int(),
});

export const lessonsApiResponseSchema = z.object({
  courseLevel: z.object({
    slug: z.string(),
    title: z.string(),
    sortOrder: z.number().int(),
  }),
  lessons: z.array(lessonCatalogEntrySchema),
});

export type LessonsApiResponse = z.infer<typeof lessonsApiResponseSchema>;
export type LessonCatalogEntryParsed = z.infer<typeof lessonCatalogEntrySchema>;
