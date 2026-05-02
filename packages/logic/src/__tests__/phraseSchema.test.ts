import { describe, expect, it } from 'vitest';
import { phraseSchema, transcriptResponseSchema } from '../schemas/phrase';
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

describe('phraseSchema', () => {
  it('parses phrases without type', () => {
    const r = phraseSchema.parse(minimalPhrase);
    expect(r.type).toBeUndefined();
  });

  it('accepts type new and composite', () => {
    expect(phraseSchema.parse({ ...minimalPhrase, type: 'new' as const }).type).toBe(
      'new',
    );
    expect(
      phraseSchema.parse({ ...minimalPhrase, type: 'composite' as const }).type,
    ).toBe('composite');
  });

  it('normalizes legacy combination to composite', () => {
    expect(
      phraseSchema.parse({ ...minimalPhrase, type: 'combination' as const }).type,
    ).toBe('composite');
  });

  it('preserves category and Spanish newGrammar / newWords', () => {
    const r = phraseSchema.parse({
      ...minimalPhrase,
      category: 'Polite phrases',
      Spanish: {
        ...minimalPhrase.Spanish,
        newGrammar: 'polite address',
        newWords: 'perdón, señor',
      },
    });
    expect(r.category).toBe('Polite phrases');
    expect(r.Spanish.newGrammar).toBe('polite address');
    expect(r.Spanish.newWords).toBe('perdón, señor');
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
      { ...minimalPhrase, name: '1', index: 0, type: 'new' as const },
      { ...minimalPhrase, name: '2', index: 1, type: 'combination' as const },
      { ...minimalPhrase, name: '3', index: 2, type: 'composite' as const },
      { ...minimalPhrase, name: '4', index: 3 },
    ];
    const parsed = transcriptResponseSchema.parse(rows);
    expect(parsed[0]!.type).toBe('new');
    expect(parsed[1]!.type).toBe('composite');
    expect(parsed[2]!.type).toBe('composite');
    expect(parsed[3]!.type).toBeUndefined();
  });
});
