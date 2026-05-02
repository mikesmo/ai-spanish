import { describe, expect, it } from 'vitest';
import { parseLessonFileJson, lessonFileSchema } from '../schemas/lessonFile';
import { POS_WEIGHTS } from '../weights';

const minimalPhrase = {
  name: 'a',
  index: 0,
  English: { 'first-intro': '', 'second-intro': 'i', question: 'q' },
  Spanish: {
    grammar: '',
    answer: 'hola',
    words: [{ word: 'hola', type: 'noun' as const, weight: POS_WEIGHTS.noun }],
  },
};

describe('lessonFileSchema', () => {
  it('parses meta + phrases', () => {
    const row = lessonFileSchema.parse({
      meta: {
        lessonId: '1',
        sortOrder: 1,
        title: 'T',
        description: 'D',
      },
      phrases: [minimalPhrase],
    });
    expect(row.meta.lessonId).toBe('1');
    expect(row.phrases).toHaveLength(1);
  });

  it('parseLessonFileJson rejects bare array', () => {
    expect(() => parseLessonFileJson([minimalPhrase], 'x')).toThrow(/bare array/);
  });
});
