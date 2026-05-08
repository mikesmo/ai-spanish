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

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], [], false, 1);
      const record = tracker.getRecord(phrase.name)!;

      expect(record.grammarGradingStatus).toBe('pending');
      expect(record.incorrectGrammarItems).toEqual([]);
      expect(record.incorrectWords).toEqual([normalizeStr('hello')]);
      expect(record.isFullyResolved).toBe(false);
    });

    it('resolves own words on success without touching grammar (grammar is deferred)', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hello', 1], ['world', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], [], false, 1);
      tracker.recordMissingWords(phrase.name, phrase, [], [], true, 2);

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

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], [], false, 1);

      const result = aiResult([]);
      tracker.applyAiGrading(phrase.name, phrase, result, ['hello'], false, 1, true);

      const record = tracker.getRecord(phrase.name)!;
      expect(record.grammarGradingStatus).toBe('success');
      expect(record.incorrectGrammarItems).toEqual([]);
      expect(record.isFullyResolved).toBe(false);
    });

    it('after fail → success attempt AI grading → sets all grammar items as resolved', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p-same', 'polite address', [['hello', 1], ['world', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], [], false, 1);
      tracker.recordMissingWords(phrase.name, phrase, [], [], true, 2);

      const result = aiResult([]);
      const resolved = tracker.applyAiGrading(phrase.name, phrase, result, [], true, 2, true);

      const record = tracker.getRecord(phrase.name)!;
      expect(record.grammarGradingStatus).toBe('success');
      expect(record.incorrectGrammarItems).toEqual([]);
      expect(record.isFullyResolved).toBe(true);
      expect(resolved).toContain(phrase.name);
    });

    it('marks specific grammar items as failed', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address, verb conjugation', [['hello', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], [], false, 1);
      tracker.applyAiGrading(phrase.name, phrase, aiResult(['polite address']), ['hello'], false, 1, true);

      const record = tracker.getRecord(phrase.name)!;
      expect(record.incorrectGrammarItems).toHaveLength(1);
      expect(record.incorrectGrammarItems[0].item).toBe('polite address');
      expect(record.incorrectGrammarItems[0].resolvedByEventSeq).toBeNull();
    });

    it('propagates demonstrated-correct grammar items to resolve other records', () => {
      const tracker = createIncorrectPhraseTracker();
      const phraseA = phraseBase('p-a', 'polite address', [['hello', 1], ['world', 1]]);
      const phraseB = phraseBase('p-b', 'polite address', [['hello', 1], ['there', 1]]);

      tracker.recordMissingWords(phraseB.name, phraseB, ['hello'], [], false, 1);
      tracker.applyFallbackClassification(phraseB.name, phraseB, ['hello'], false, 1, true, 'failed');

      tracker.recordMissingWords(phraseA.name, phraseA, [], [], true, 2);
      const resolved = tracker.applyAiGrading(phraseA.name, phraseA, aiResult([]), [], true, 2, true);

      const recordB = tracker.getRecord(phraseB.name)!;
      expect(recordB.incorrectGrammarItems[0].resolvedByEventSeq).toBe(2);
      expect(resolved).toContain(phraseB.name);
    });

    it('does not cross-resolve grammar items that differ between phrases', () => {
      const tracker = createIncorrectPhraseTracker();
      const phraseLong = phraseBase('p-long', 'polite address, negative reply', [['hello', 1], ['world', 1]]);
      const phraseShort = phraseBase('p-short', 'polite address', [['hello', 1], ['world', 1]]);

      tracker.recordMissingWords(phraseLong.name, phraseLong, ['hello'], [], false, 1);
      tracker.applyFallbackClassification(phraseLong.name, phraseLong, ['hello'], false, 1, true, 'failed');

      tracker.recordMissingWords(phraseShort.name, phraseShort, [], [], true, 2);
      tracker.applyAiGrading(phraseShort.name, phraseShort, aiResult([]), [], true, 2, true);

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
      tracker.recordMissingWords(phrase.name, phrase, [], [], true, 2);
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

  describe('accuracy-success-with-mismatch record creation (bug fix)', () => {
    it('creates a pending record when accuracy is success but a word is missing', () => {
      const tracker = createIncorrectPhraseTracker();
      // Replays the "de" bug: accuracy 0.882, isAccuracySuccess=true, one missing word.
      const phrase = phraseBase('habla-un-poco-de-ingles', 'de + noun', [
        ['habla', 1], ['un', 1], ['poco', 1], ['de', 1], ['inglés', 1],
      ]);

      tracker.recordMissingWords(phrase.name, phrase, ['de'], [], true, 1);

      const record = tracker.getRecord(phrase.name)!;
      expect(record).toBeDefined();
      expect(record.grammarGradingStatus).toBe('pending');
      expect(record.incorrectWords).toContain(normalizeStr('de'));
      expect(record.incorrectGrammarItems).toEqual([]);
      expect(record.isFullyResolved).toBe(false);
    });

    it('creates a pending record when accuracy is success but there are extra words', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hola', 1], ['señor', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, [], ['ay'], true, 1);

      const record = tracker.getRecord(phrase.name)!;
      expect(record).toBeDefined();
      expect(record.grammarGradingStatus).toBe('pending');
      expect(record.incorrectWords).toEqual([]);
      expect(record.isFullyResolved).toBe(false);
    });

    it('does NOT create a record when it is an exact match (no missing, no extras)', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hola', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, [], [], true, 1);

      expect(tracker.getRecord(phrase.name)).toBeUndefined();
    });

    it('applyAiGrading writes failed items unresolved even when isAccuracySuccess is true', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('habla-un-poco-de-ingles', 'de + noun, yes/no question', [
        ['habla', 1], ['un', 1], ['poco', 1], ['de', 1], ['inglés', 1],
      ]);

      // Step 1: accuracy-success attempt with one missing word creates the pending record.
      tracker.recordMissingWords(phrase.name, phrase, ['de'], [], true, 1);

      // Step 2: AI returns failed grammar items.
      tracker.applyAiGrading(
        phrase.name,
        phrase,
        aiResult(['de + noun', 'yes/no question']),
        ['de'],
        true,
        1,
        true,
      );

      const record = tracker.getRecord(phrase.name)!;
      expect(record.grammarGradingStatus).toBe('success');
      expect(record.incorrectGrammarItems).toHaveLength(2);

      // Both items must be unresolved — the user did not demonstrate them.
      for (const entry of record.incorrectGrammarItems) {
        expect(entry.resolvedByEventSeq).toBeNull();
      }

      // Rationale is preserved.
      const deNounEntry = record.incorrectGrammarItems.find((g) => g.item === 'de + noun')!;
      expect(deNounEntry.rationale).toBe('test rationale');
    });

    it('applyAiGrading with no failed items still resolves the record when words are also resolved', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hola', 1], ['señor', 1]]);

      // Accuracy-success with a missing word — record created.
      tracker.recordMissingWords(phrase.name, phrase, ['hola'], [], true, 1);

      // AI returns no grammar failures.
      const resolved = tracker.applyAiGrading(phrase.name, phrase, aiResult([]), ['hola'], true, 1, true);

      const record = tracker.getRecord(phrase.name)!;
      expect(record.grammarGradingStatus).toBe('success');
      expect(record.incorrectGrammarItems).toEqual([]);
      // 'hola' is still missing — record not fully resolved yet.
      expect(record.isFullyResolved).toBe(false);
      expect(resolved).not.toContain(phrase.name);
    });
  });

  describe('per-item mastery scoring', () => {
    it('records a grammar item score on the failed entry after applyAiGrading', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address, verb conjugation', [['hello', 1]]);

      tracker.recordMissingWords(phrase.name, phrase, ['hello'], [], false, 1);
      tracker.applyAiGrading(phrase.name, phrase, aiResult(['polite address']), ['hello'], false, 1, true);

      const record = tracker.getRecord(phrase.name)!;
      const failedEntry = record.incorrectGrammarItems.find((g) => g.item === 'polite address')!;
      expect(failedEntry.score).toBeDefined();
      expect(failedEntry.score!.trialsEff).toBeGreaterThan(0);
      // Failed -> mastery should be in the weak band
      expect(failedEntry.score!.mastery).toBeLessThan(0.6);

      // Item not flagged as failed under accuracy failure -> ambiguous, no score
      // (skipped per algorithm).
      expect(tracker.getGrammarItemScores().has('verb conjugation')).toBe(false);
    });

    it('cross-phrase grammar fan-out: passing item X in phrase B updates phrase A entry score', () => {
      const tracker = createIncorrectPhraseTracker();
      const phraseA = phraseBase('p-a', 'polite address', [['hola', 1]]);
      const phraseB = phraseBase('p-b', 'polite address', [['buenos', 1]]);

      // Phrase A fails -> item "polite address" entry is created with a failure trial.
      tracker.recordMissingWords(phraseA.name, phraseA, ['hola'], [], false, 1);
      tracker.applyAiGrading(phraseA.name, phraseA, aiResult(['polite address']), ['hola'], false, 1, true);
      // Snapshot scalar values — entry.score is mutated in place by fan-out so
      // capturing the entry by reference would not preserve the "before" state.
      const beforeMastery = tracker.getRecord(phraseA.name)!.incorrectGrammarItems[0].score!.mastery;
      const beforeSuccessSum = tracker.getRecord(phraseA.name)!.incorrectGrammarItems[0].score!.successSumEff;

      // Phrase B successfully demonstrates "polite address" (not in failedGrammarItems
      // and isAccuracySuccess=true) -> x=1 trial. Fan-out should update phrase A entry.
      tracker.recordMissingWords(phraseB.name, phraseB, [], [], true, 5);
      tracker.applyAiGrading(phraseB.name, phraseB, aiResult([]), [], true, 5, true);

      const after = tracker.getRecord(phraseA.name)!.incorrectGrammarItems[0].score!;
      expect(after.lastUpdatedAtEventSeq).toBe(5);
      expect(after.mastery).toBeGreaterThan(beforeMastery);
      expect(after.successSumEff).toBeGreaterThan(beforeSuccessSum);
    });

    it('cross-phrase word fan-out: passing word "hola" in phrase B updates phrase A entry score', () => {
      const tracker = createIncorrectPhraseTracker();
      const phraseA = phraseBase('p-a', 'g-x', [['hola', 1], ['mundo', 1]]);
      const phraseB = phraseBase('p-b', 'g-y', [['hola', 1], ['amigo', 1]]);

      // Phrase A fails on "hola" -> creates a WordMistakeEntry on record A.
      tracker.recordMissingWords(phraseA.name, phraseA, ['hola'], [], false, 1);
      tracker.applyAiGrading(phraseA.name, phraseA, aiResult([]), ['hola'], false, 1, true);

      const recordA = tracker.getRecord(phraseA.name)!;
      const helloEntry = recordA.incorrectWordEntries.find((e) => e.word === normalizeStr('hola'))!;
      expect(helloEntry).toBeDefined();
      const beforeMastery = helloEntry.score!.mastery;
      expect(beforeMastery).toBeLessThan(0.6);

      // Phrase B says everything correctly including "hola" -> x=1 trial for hola.
      tracker.recordMissingWords(phraseB.name, phraseB, [], [], true, 5);
      tracker.applyAiGrading(phraseB.name, phraseB, aiResult([]), [], true, 5, true);

      const helloEntryAfter = tracker
        .getRecord(phraseA.name)!
        .incorrectWordEntries.find((e) => e.word === normalizeStr('hola'))!;
      expect(helloEntryAfter.score!.lastUpdatedAtEventSeq).toBe(5);
      expect(helloEntryAfter.score!.mastery).toBeGreaterThan(beforeMastery);
    });

    it('reveal event decays grammar and word scores without bumping trialsEff', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hola', 1]]);

      // Build up some mastery.
      tracker.recordMissingWords(phrase.name, phrase, ['hola'], [], false, 1);
      tracker.applyAiGrading(phrase.name, phrase, aiResult(['polite address']), ['hola'], false, 1, true);
      tracker.recordMissingWords(phrase.name, phrase, [], [], true, 2);
      tracker.applyAiGrading(phrase.name, phrase, aiResult([]), [], true, 2, true);

      const grammarBefore = tracker.getGrammarItemScores().get('polite address')!;
      const wordBefore = tracker.getWordScores().get(normalizeStr('hola'))!;
      expect(grammarBefore.stability).toBeGreaterThan(0);
      expect(wordBefore.stability).toBeGreaterThan(0);

      // Reveal -> 'n/a' fallback path decays both axes.
      const allWords = phrase.Spanish.words.map((w) => w.word);
      tracker.applyFallbackClassification(phrase.name, phrase, allWords, false, 9, true, 'n/a');

      const grammarAfter = tracker.getGrammarItemScores().get('polite address')!;
      const wordAfter = tracker.getWordScores().get(normalizeStr('hola'))!;
      expect(grammarAfter.trialsEff).toBe(grammarBefore.trialsEff);
      expect(wordAfter.trialsEff).toBe(wordBefore.trialsEff);
      expect(grammarAfter.stability).toBeLessThan(grammarBefore.stability);
      expect(wordAfter.stability).toBeLessThan(wordBefore.stability);
      expect(grammarAfter.mastery).toBeLessThan(grammarBefore.mastery);
    });

    it('ambiguous case (item not flagged + accuracy failure) leaves the score untouched', () => {
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address, verb conjugation', [['hello', 1]]);

      // accuracy failure, AI flags only "polite address"; "verb conjugation" is ambiguous -> skipped.
      tracker.recordMissingWords(phrase.name, phrase, ['hello'], [], false, 1);
      tracker.applyAiGrading(phrase.name, phrase, aiResult(['polite address']), ['hello'], false, 1, true);

      expect(tracker.getGrammarItemScores().has('polite address')).toBe(true);
      expect(tracker.getGrammarItemScores().has('verb conjugation')).toBe(false);
    });

    it('rehydrates score maps from seed records (latest eventSeq wins)', () => {
      const seedRecord = {
        phraseId: 'p1',
        incorrectWords: [normalizeStr('hola')],
        resolvedWords: [],
        incorrectGrammarItems: [
          {
            item: 'polite address',
            failedAtEventSeq: 1,
            resolvedByEventSeq: null,
            score: {
              trialsEff: 3,
              successSumEff: 1,
              stability: 0.4,
              mastery: 0.45,
              lastUpdatedAtEventSeq: 12,
            },
          },
        ],
        incorrectWordEntries: [
          {
            word: normalizeStr('hola'),
            failedAtEventSeq: 1,
            resolvedByEventSeq: null,
            score: {
              trialsEff: 4,
              successSumEff: 2,
              stability: 0.5,
              mastery: 0.55,
              lastUpdatedAtEventSeq: 18,
            },
          },
        ],
        grammarGradingStatus: 'success' as const,
        failedAtEventSeq: 1,
        isFullyResolved: false,
      };

      const tracker = createIncorrectPhraseTracker([seedRecord]);
      const grammar = tracker.getGrammarItemScores().get('polite address');
      const word = tracker.getWordScores().get(normalizeStr('hola'));
      expect(grammar?.lastUpdatedAtEventSeq).toBe(12);
      expect(word?.lastUpdatedAtEventSeq).toBe(18);
    });

    it('practice events do not update scores (no tracker call from session)', () => {
      // Practice events are filtered out at the useLessonSession level (they
      // never invoke applyAiGrading or applyFallbackClassification). This
      // test asserts that calling neither method leaves the score maps empty
      // — i.e. the tracker has no implicit hook that fires on its own.
      const tracker = createIncorrectPhraseTracker();
      const phrase = phraseBase('p1', 'polite address', [['hello', 1]]);
      tracker.recordMissingWords(phrase.name, phrase, ['hello'], [], false, 1);

      expect(tracker.getGrammarItemScores().size).toBe(0);
      expect(tracker.getWordScores().size).toBe(0);
    });
  });
});
