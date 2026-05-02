import { describe, expect, it } from 'vitest';
import { lessonsApiResponseSchema } from '../schemas/lessonCatalogApi';

describe('lessonsApiResponseSchema', () => {
  it('parses API payload', () => {
    const parsed = lessonsApiResponseSchema.parse({
      courseLevel: { slug: 'beginner', title: 'Beginner', sortOrder: 0 },
      lessons: [
        {
          lessonId: '1',
          title: 'Lesson 1',
          description: 'Hello',
          sortOrder: 1,
        },
      ],
    });
    expect(parsed.lessons).toHaveLength(1);
    expect(parsed.lessons[0]!.lessonId).toBe('1');
  });
});
