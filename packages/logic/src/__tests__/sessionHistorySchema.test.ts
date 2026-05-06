import { describe, expect, it } from 'vitest';
import { historyEntrySchema } from '../schemas/sessionHistory';
import { POS_WEIGHTS } from '../weights';

/** Contract: persisted session history entries may carry fully-redeemed failure event #s for the sidebar banner. */
describe('historyEntrySchema', () => {
  it('accepts optional incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs', () => {
    const minimal = {
      id: 'e1',
      event: {
        eventType: 'attempt' as const,
        phraseId: 'p1',
        transcript: ['hola'],
        missingWords: [],
        extraWords: [],
        accuracyScore: 1,
        fluencyScore: null,
        isAccuracySuccess: true,
        success: true,
        timestamp: 0,
        accuracyBreakdown: {
          accuracy: 1,
          totalWeight: 1,
          missingPenalty: 0,
          extraPenalty: 0,
          rawExtraPenalty: 0,
        },
        fluencyBreakdown: null,
      },
      phrase: {
        name: 'p1',
        index: 0,
        English: {
          'first-intro': '',
          'second-intro': '',
          question: '',
          'follow-up': '',
          explain: '',
        },
        Spanish: {
          grammar: '',
          answer: 'Hola',
          words: [
            { word: 'Hola', type: 'noun' as const, weight: POS_WEIGHTS.noun },
          ],
        },
      },
      scoreSummary: {
        accuracy: 1,
        fluency: null,
        mastery: 0.5,
        isAccuracySuccess: true,
      },
      stabilityBreakdown: {
        before: 0,
        after: 0.5,
        kind: 'attempt_ema' as const,
        emaInput: 1 as const,
      },
      masteryBefore: 0,
      masteryAfter: 0.5,
      isRepeatedPresentation: false,
      dueOnLessonSessionIndex: 0,
      slotsAheadAtEvent: null,
      eventSeq: 2,
      incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs: [1, 3],
    };
    const parsed = historyEntrySchema.parse(minimal);
    expect(parsed.incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs).toEqual([
      1, 3,
    ]);
  });
});
