import { z } from 'zod';

/**
 * Response shape for `GET /api/lesson-completions` (no `lesson` query param) —
 * lists every lesson the authenticated user has at least one completion for.
 */
export const completedLessonsListResponseSchema = z.object({
  completedLessonIds: z.array(z.string().min(1)),
});

export type CompletedLessonsListResponse = z.infer<
  typeof completedLessonsListResponseSchema
>;
