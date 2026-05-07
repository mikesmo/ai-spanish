import { describe, expect, it } from 'vitest';
import { createIncorrectPhraseTracker } from '../incorrectPhraseTracker';
import { normalizeStr } from '../comparison';
import type { GrammarGradingResult } from '../grammarGrading';
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

const aiResult = (failedItems: string[], wordMistakes: string[] = []): GrammarGradingResult => ({
  failedGrammarItems: failedItems.map((item) => ({ item, rationale: 'test rationale' })),
  wordMistakes,
});

describe('createIncorrectPhraseTracker', () => {
  describe('recordMissingWords', () => {
    it('creates a pending record on failure', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hello', 1], ['world', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], false, 1);
      const record = tracker.getRecord(phrase.name)!;

      expect(record.grammarGradingStatus).toBe('pending');
      expect(record.incorrectGrammarItems).toEqual([]);
      expect(record.incorrectWords).toEqual([normalizeStr('hello')]);
      expect(record.isFullyResolved).toBe(false);
    });

    it('resolves own words on success without touching grammar (grammar is deferred)', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hello', 1], ['world', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], false, 1);
      tracker.recordMissingWords(phrase.name, phrase, [], true, 2);

      const record = tracker.getRecord(phrase.name)!;
      expect(record.resolvedWords).toEqual([{ word: normalizeStr('hello'), resolvedByEventSeq: 2 }]);
      expect(record.grammarGradingStatus).toBe('pending');
      expect(record.isFullyResolved).toBe(false);
    });
  });

  describe('applyAiGrading', () => {
    it('after fail → AI grading with no grammar failures → fully resolved once words are also resolved', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p-same', 'polite address', [['hello', 1], ['world', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], false, 1);

      const result = aiResult([]);
      tracker.applyAiGrading(phrase.name, phrase, result, false, 1, true);

      const record = tracker.getRecord(phrase.name)!;
      expect(record.grammarGradingStatus).toBe('success');
      expect(record.incorrectGrammarItems).toEqual([]);
      expect(record.isFullyResolved).toBe(false);
    });

    it('after fail → success attempt AI grading → sets all grammar items as resolved', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p-same', 'polite address', [['hello', 1], ['world', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], false, 1);
      tracker.recordMissingWords(phrase.name, phrase, [], true, 2);

      const result = aiResult([]);
      const resolved = tracker.applyAiGrading(phrase.name, phrase, result, true, 2, true);

      const record = tracker.getRecord(phrase.name)!;
      expect(record.grammarGradingStatus).toBe('success');
      expect(record.incorrectGrammarItems).toEqual([]);
      expect(record.isFullyResolved).toBe(true);
      expect(resolved).toContain(phrase.name);
    });

    it('marks specific grammar items as failed', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address, verb conjugation', [['hello', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], false, 1);
      tracker.applyAiGrading(phrase.name, phrase, aiResult(['polite address']), false, 1, true);

      const record = tracker.getRecord(phrase.name)!;
      expect(record.incorrectGrammarItems).toHaveLength(1);
      expect(record.incorrectGrammarItems[0].item).toBe('polite address');
      expect(record.incorrectGrammarItems[0].resolvedByEventSeq).toBeNull();
    });

    it('propagates demonstrated-correct grammar items to resolve other records', () => {
      const tracker = createIncorrectPhraseTracker();
      const phraseA = phraseBase('p-a', 'polite address', [['hello', 1], ['world', 1]]);
      const phraseB = phraseBase('p-b', 'polite address', [['hello', 1], ['there', 1]]);

      tracker.recordMissingWords(phraseB.name, phraseB, ['hello'], false, 1);
      tracker.applyFallbackClassification(phraseB.name, phraseB, ['hello'], false, 1, true, 'failed');

      tracker.recordMissingWords(phraseA.name, phraseA, [], true, 2);
      const resolved = tracker.applyAiGrading(phraseA.name, phraseA, aiResult([]), true, 2, true);

      const recordB = tracker.getRecord(phraseB.name)!;
      expect(recordB.incorrectGrammarItems[0].resolvedByEventSeq).toBe(2);
      expect(resolved).toContain(phraseB.name);
    });

    it('does not cross-resolve grammar items that differ between phrases', () => {
      const tracker = createIncorrectPhraseTracker();
      const phraseLong = phraseBase('p-long', 'polite address, negative reply', [['hello', 1], ['world', 1]]);
      const phraseShort = phraseBase('p-short', 'polite address', [['hello', 1], ['world', 1]]);

      tracker.recordMissingWords(phraseLong.name, phraseLong, ['hello'], false, 1);
      tracker.applyFallbackClassification(phraseLong.name, phraseLong, ['hello'], false, 1, true, 'failed');

      tracker.recordMissingWords(phraseShort.name, phraseShort, [], true, 2);
      tracker.applyAiGrading(phraseShort.name, phraseShort, aiResult([]), true, 2, true);

      const recordLong = tracker.getRecord(phraseLong.name)!;
      expect(recordLong.resolvedWords.some((r) => r.word === normalizeStr('hello'))).toBe(true);
      expect(recordLong.incorrectGrammarItems.every((g) => g.resolvedByEventSeq === null)).toBe(true);
      expect(recordLong.isFullyResolved).toBe(false);
    });
  });

  describe('applyFallbackClassification', () => {
    it('creates a record with the whole grammar string as one item on failure', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hello', 1]]);

      tracker.applyFallbackClassification(phrase.name, phrase, ['hello'], false, 1, true, 'failed');

      const record = tracker.getRecord(phrase.name)!;
      expect(record.grammarGradingStatus).toBe('failed');
      expect(record.incorrectGrammarItems).toHaveLength(1);
      expect(record.incorrectGrammarItems[0].item).toBe('polite address');
      expect(record.isFullyResolved).toBe(false);
    });

    it('resolves the fallback grammar item on a later pass', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hello', 1]]);

      tracker.applyFallbackClassification(phrase.name, phrase, ['hello'], false, 1, true, 'failed');
      tracker.recordMissingWords(phrase.name, phrase, [], true, 2);
      const resolved = tracker.applyFallbackClassification(phrase.name, phrase, [], true, 2, true, 'failed');

      const record = tracker.getRecord(phrase.name)!;
      expect(record.incorrectGrammarItems[0].resolvedByEventSeq).toBe(2);
      expect(record.isFullyResolved).toBe(true);
      expect(resolved).toContain(phrase.name);
    });

    it('n/a status is used for reveal events', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hello', 1]]);
      const allWords = phrase.Spanish.words.map((w) => w.word);

      tracker.applyFallbackClassification(phrase.name, phrase, allWords, false, 1, true, 'n/a');

      const record = tracker.getRecord(phrase.name)!;
      expect(record.grammarGradingStatus).toBe('n/a');
    });
  });
});
