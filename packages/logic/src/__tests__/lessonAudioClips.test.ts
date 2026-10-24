import { describe, expect, it } from 'vitest';
import { buildLessonAudioClipList, lessonAudioClipId } from '../lessonAudioClips';
import type { Phrase } from '../types';
import { POS_WEIGHTS } from '../weights';

const phrase = (name: string, overrides: Partial<Phrase['English']> = {}): Phrase => ({
  name,
  index: 0,
  English: {
    'first-intro': '',
    'second-intro': 'Say it?',
    question: 'Hello.',
    'follow-up': '',
    explain: '',
    ...overrides,
  },
  Spanish: {
    grammar: 'g',
    answer: 'Hola.',
    words: [{ word: 'Hola', lemma: 'hola', type: 'noun', weight: POS_WEIGHTS.noun }],
  },
});

const ids = (deck: Phrase[], start?: string): string[] =>
  buildLessonAudioClipList(deck, start).map((c) => lessonAudioClipId(c.phraseName, c.segment));

describe('buildLessonAudioClipList', () => {
  it('lists non-empty segments in playback order with answer-slow last', () => {
    const deck = [
      phrase('a', { 'first-intro': 'Intro:', 'follow-up': 'Now you.', explain: 'Why.' }),
      phrase('b'),
    ];
    expect(ids(deck)).toEqual([
      'a-first-intro',
      'a-second-intro',
      'a-question',
      'a-answer-medium',
      'a-follow-up',
      'a-answer',
      'a-explain',
      'b-second-intro',
      'b-answer-medium',
      'b-answer',
      'a-answer-slow',
      'b-answer-slow',
    ]);
  });

  it('starts at the given phrase and wraps around the deck', () => {
    const deck = [phrase('a'), phrase('b'), phrase('c')];
    const firstIntros = ids(deck, 'b').filter((id) => id.endsWith('-second-intro'));
    expect(firstIntros).toEqual(['b-second-intro', 'c-second-intro', 'a-second-intro']);
  });

  it('falls back to deck order for an unknown start phrase and dedupes names', () => {
    const deck = [phrase('a'), phrase('a'), phrase('b')];
    const intros = ids(deck, 'missing').filter((id) => id.endsWith('-second-intro'));
    expect(intros).toEqual(['a-second-intro', 'b-second-intro']);
  });
});
