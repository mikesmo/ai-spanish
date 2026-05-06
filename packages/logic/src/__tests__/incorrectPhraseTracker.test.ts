import { describe, expect, it } from 'vitest';
import { createIncorrectPhraseTracker } from '../incorrectPhraseTracker';
import { normalizeStr } from '../comparison';
import type { Phrase } from '../types';

const englishBlock = {
  'first-intro': '',
  'second-intro': '',
  question: 'q',
  'follow-up': '',
  explain: '',
};

const phraseBase = (name: string, grammar: string, wordSpecs: [string, number][]): Phrase => ({
  name,
  index: 0,
  English: englishBlock,
  Spanish: {
    grammar,
    answer: wordSpecs.map(([w]) => w).join(' '),
    words: wordSpecs.map(([word, weight]) => ({
      word,
      type: 'noun' as const,
      weight,
    })),
  },
});

describe('createIncorrectPhraseTracker', () => {
  it('after fail→pass on same phrase, fills grammarResolvedByEventSeq and resolvedWords', () => {
    const tracker = createIncorrectPhraseTracker();
    const phrase = phraseBase('p-same', 'polite address', [
      ['hello', 1],
      ['world', 1],
    ]);

    tracker.recordAttempt(phrase.name, phrase, ['hello'], false, 1, true);
    const afterFail = tracker.getRecord(phrase.name)!;
    expect(afterFail.grammarResolvedByEventSeq).toBeNull();
    expect(afterFail.resolvedWords).toEqual([]);
    expect(afterFail.isFullyResolved).toBe(false);
    expect(afterFail.incorrectWords).toEqual([normalizeStr('hello')]);

    tracker.recordAttempt(phrase.name, phrase, [], true, 2, true);
    const afterPass = tracker.getRecord(phrase.name)!;
    expect(afterPass.grammarResolvedByEventSeq).toBe(2);
    expect(afterPass.resolvedWords).toEqual([
      { word: normalizeStr('hello'), resolvedByEventSeq: 2 },
    ]);
    expect(afterPass.isFullyResolved).toBe(true);
  });

  it('propagates grammar credit to another phrase with matching incorrectGrammar', () => {
    const tracker = createIncorrectPhraseTracker();
    const phraseA = phraseBase('p-a', 'polite address', [
      ['hello', 1],
      ['world', 1],
    ]);
    const phraseB = phraseBase('p-b', 'polite address', [
      ['hello', 1],
      ['there', 1],
    ]);

    tracker.recordAttempt(phraseB.name, phraseB, ['hello'], false, 1, true);
    tracker.recordAttempt(phraseA.name, phraseA, [], true, 2, true);

    const recordB = tracker.getRecord(phraseB.name)!;
    expect(recordB.grammarResolvedByEventSeq).toBe(2);
    expect(recordB.resolvedWords.some((r) => r.word === normalizeStr('hello'))).toBe(true);
    expect(recordB.isFullyResolved).toBe(true);
  });

  it('does not mark fully resolved when all missing words propagate but grammar strings differ', () => {
    const tracker = createIncorrectPhraseTracker();
    const phraseLong = phraseBase('p-long', 'polite address, negative reply', [
      ['hello', 1],
      ['world', 1],
    ]);
    const phraseShort = phraseBase('p-short', 'polite address', [
      ['hello', 1],
      ['world', 1],
    ]);

    tracker.recordAttempt(phraseLong.name, phraseLong, ['hello'], false, 1, true);
    tracker.recordAttempt(phraseShort.name, phraseShort, [], true, 2, true);

    const recordLong = tracker.getRecord(phraseLong.name)!;
    expect(recordLong.resolvedWords).toEqual([
      { word: normalizeStr('hello'), resolvedByEventSeq: 2 },
    ]);
    expect(recordLong.grammarResolvedByEventSeq).toBeNull();
    expect(recordLong.isFullyResolved).toBe(false);
  });
});
