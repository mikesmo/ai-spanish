import { describe, expect, it } from 'vitest';
import {
  buildPhraseAudioClipSpecs,
  PHRASE_ANSWER_MEDIUM_CLIP_SUFFIX,
  PHRASE_ANSWER_SLOW_CLIP_SUFFIX,
} from '../phraseAudioClipSpecs';
import { phraseSynthSegmentFromClipId } from '../phraseAudioSegments';
import type { Phrase } from '../types';
import { POS_WEIGHTS } from '../weights';

const phrase = (overrides: Partial<Phrase>): Phrase => ({
  name: 'test-phrase',
  index: 0,
  English: {
    'first-intro': '',
    'second-intro': 'Say it?',
    question: 'Hello.',
    'follow-up': '',
    explain: '',
  },
  Spanish: {
    grammar: 'g',
    answer: 'Hola.',
    words: [{ word: 'Hola', type: 'noun', weight: POS_WEIGHTS.noun }],
  },
  ...overrides,
});

describe('phraseSynthSegmentFromClipId', () => {
  it('maps answer-medium, answer-slow to answer for verify/merge semantics', () => {
    expect(phraseSynthSegmentFromClipId('foo-answer-medium')).toBe('answer');
    expect(phraseSynthSegmentFromClipId('foo-answer-slow')).toBe('answer');
    expect(phraseSynthSegmentFromClipId('foo-answer')).toBe('answer');
  });

  it('maps follow-up and explain clip ids to synth segments', () => {
    expect(phraseSynthSegmentFromClipId('foo-follow-up')).toBe('follow-up');
    expect(phraseSynthSegmentFromClipId('foo-explain')).toBe('explain');
  });
});

describe('buildPhraseAudioClipSpecs', () => {
  it('emits triple Spanish answer clips with speakingRate 1, 0.9, and 0.7', () => {
    const specs = buildPhraseAudioClipSpecs([phrase({})]);
    const answerSpecs = specs.filter((s) => s.id.includes('answer'));
    expect(answerSpecs).toHaveLength(3);
    expect(answerSpecs.some((s) => s.id.endsWith(`-${PHRASE_ANSWER_MEDIUM_CLIP_SUFFIX}`))).toBe(
      true,
    );
    expect(answerSpecs.some((s) => s.id.endsWith(`-${PHRASE_ANSWER_SLOW_CLIP_SUFFIX}`))).toBe(
      true,
    );
    expect(answerSpecs.find((s) => s.id.endsWith('-answer'))?.speakingRate).toBe(1);
    expect(answerSpecs.find((s) => s.id.endsWith('-answer-medium'))?.speakingRate).toBe(0.9);
    expect(answerSpecs.find((s) => s.id.endsWith('-answer-slow'))?.speakingRate).toBe(0.7);
  });

  it('includes follow-up and explain when non-empty', () => {
    const specs = buildPhraseAudioClipSpecs([
      phrase({
        English: {
          'first-intro': '',
          'second-intro': 'q',
          question: 'x',
          'follow-up': 'Try now.',
          explain: 'Grammar note.',
        },
      }),
    ]);
    expect(specs.some((s) => s.id.endsWith('-follow-up'))).toBe(true);
    expect(specs.some((s) => s.id.endsWith('-explain'))).toBe(true);
  });
});
