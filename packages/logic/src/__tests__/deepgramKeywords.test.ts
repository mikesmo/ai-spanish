import { describe, expect, it } from 'vitest';
import { deepgramLiveKeywordTokensForPhrase } from '../deepgramKeywords';
import type { Phrase } from '../types';
import { POS_WEIGHTS } from '../weights';

const phraseBase = (spanish: Partial<Phrase['Spanish']> & Pick<Phrase['Spanish'], 'answer' | 'words'>): Phrase => ({
  name: 't',
  index: 0,
  English: {
    'first-intro': '',
    'second-intro': 's',
    question: 'q',
    'follow-up': '',
    explain: '',
  },
  Spanish: {
    grammar: 'g',
    ...spanish,
  },
});

describe('deepgramLiveKeywordTokensForPhrase', () => {
  it('uses recognitionHints when non-empty (any word count)', () => {
    const p = phraseBase({
      answer: 'Una frase larga con muchas palabras.',
      recognitionHints: 'Perdón, señor',
      words: [
        { word: 'Una', type: 'article', weight: POS_WEIGHTS.article },
        { word: 'frase', type: 'noun', weight: POS_WEIGHTS.noun },
        { word: 'larga', type: 'adjective', weight: POS_WEIGHTS.adjective },
      ],
    });
    expect(deepgramLiveKeywordTokensForPhrase(p)).toEqual(['perdón', 'señor']);
  });

  it('falls back to answer tokenization when hints empty and 1–2 words', () => {
    const p = phraseBase({
      answer: 'Hola adiós',
      words: [
        { word: 'Hola', type: 'noun', weight: POS_WEIGHTS.noun },
        { word: 'adiós', type: 'noun', weight: POS_WEIGHTS.noun },
      ],
    });
    expect(deepgramLiveKeywordTokensForPhrase(p)).toEqual(['hola', 'adiós']);
  });

  it('returns no keywords when hints empty and 3+ words', () => {
    const p = phraseBase({
      answer: 'Una dos tres',
      words: [
        { word: 'Una', type: 'article', weight: POS_WEIGHTS.article },
        { word: 'dos', type: 'noun', weight: POS_WEIGHTS.noun },
        { word: 'tres', type: 'noun', weight: POS_WEIGHTS.noun },
      ],
    });
    expect(deepgramLiveKeywordTokensForPhrase(p)).toEqual([]);
  });

  it('treats whitespace-only hints as empty (legacy path)', () => {
    const p = phraseBase({
      answer: 'hola adiós',
      recognitionHints: '   ',
      words: [
        { word: 'hola', type: 'noun', weight: POS_WEIGHTS.noun },
        { word: 'adiós', type: 'noun', weight: POS_WEIGHTS.noun },
      ],
    });
    expect(deepgramLiveKeywordTokensForPhrase(p)).toEqual(['hola', 'adiós']);
  });
});
