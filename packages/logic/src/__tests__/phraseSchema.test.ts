import { describe, expect, it } from 'vitest';
import { phraseSchema, transcriptResponseSchema } from '../schemas/phrase';
import { POS_WEIGHTS } from '../weights';

const minimalPhrase = {
  id: 'a',
  English: { intro: 'i', question: 'q', explain: '' },
  Spanish: {
    grammar: '',
    answer: 'hola',
    words: [{ word: 'hola', type: 'noun' as const, weight: POS_WEIGHTS.noun }],
  },
};

describe('phraseSchema', () => {
  it('parses phrases without type', () => {
    const r = phraseSchema.parse(minimalPhrase);
    expect(r.type).toBeUndefined();
  });

  it('accepts type new and combination', () => {
    expect(phraseSchema.parse({ ...minimalPhrase, type: 'new' as const }).type).toBe(
      'new',
    );
    expect(
      phraseSchema.parse({ ...minimalPhrase, type: 'combination' as const }).type,
    ).toBe('combination');
  });

  it('rejects invalid type', () => {
    expect(() =>
      phraseSchema.parse({ ...minimalPhrase, type: 'other' }),
    ).toThrow();
  });
});

describe('transcriptResponseSchema', () => {
  it('accepts a lesson array with mixed phrase types', () => {
    const rows = [
      { ...minimalPhrase, id: '1', type: 'new' as const },
      { ...minimalPhrase, id: '2', type: 'combination' as const },
      { ...minimalPhrase, id: '3' },
    ];
    const parsed = transcriptResponseSchema.parse(rows);
    expect(parsed[0]!.type).toBe('new');
    expect(parsed[1]!.type).toBe('combination');
    expect(parsed[2]!.type).toBeUndefined();
  });
});
