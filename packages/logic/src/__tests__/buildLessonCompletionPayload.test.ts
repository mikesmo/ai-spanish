import { describe, expect, it } from 'vitest';
import { POS_WEIGHTS } from '../weights';
import {
  buildLessonCompletionPayload,
  createLessonCompletionRunId,
} from '../buildLessonCompletionPayload';
import type { HistoryEntry } from '../useSessionHistory';
import {
  lessonSessionCompletionPayloadSchema,
} from '../schemas/lessonSessionCompletion';
import type { SessionCheckpointParsed } from '../schemas/sessionCheckpoint';

const phrase = (name: string) => ({
  name,
  index: 0,
  English: {
    'first-intro': '',
    'second-intro': '',
    question: name,
    'follow-up': '',
    explain: '',
  },
  Spanish: {
    grammar: '',
    answer: name,
    words: [{ word: name, type: 'verb' as const, weight: POS_WEIGHTS.verb }],
  },
});

const minimalCheckpoint = (lessonId: string): SessionCheckpointParsed => ({
  schemaVersion: 1,
  lessonId,
  queuePhraseIds: [],
  currentPresentedPhraseId: null,
  reinsertCount: {},
  progress: [],
});

describe('lesson completion payload', () => {
  it('createLessonCompletionRunId meets schema length', () => {
    const id = createLessonCompletionRunId();
    expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it('buildLessonCompletionPayload survives schema parse', () => {
    const p = phrase('hello');
    const entry: HistoryEntry = {
      id: 'e1',
      event: {
        eventType: 'attempt',
        phraseId: p.name,
        transcript: [],
        missingWords: [],
        extraWords: [],
        accuracyScore: 1,
        fluencyScore: 1,
        isAccuracySuccess: true,
        success: true,
        timestamp: Date.now(),
        accuracyBreakdown: {
          accuracy: 1,
          totalWeight: 1,
          missingPenalty: 0,
          extraPenalty: 0,
          rawExtraPenalty: 0,
        },
        fluencyBreakdown: {
          speedScore: 1,
          pauseScore: 1,
          gapConsistencyScore: 1,
          fluencyScore: 1,
          wordsPerSecond: 2,
          longPauses: 0,
        },
      },
      phrase: p,
      scoreSummary: {
        accuracy: 1,
        fluency: 1,
        mastery: 0.5,
        isAccuracySuccess: true,
      },
      stabilityBreakdown: {
        before: 0,
        after: 0.3,
        kind: 'attempt_ema',
        emaInput: 1,
      },
      masteryBefore: 0,
      masteryAfter: 0.5,
      isRepeatedPresentation: false,
      slotsAheadAtEvent: null,
    };

    const runId = createLessonCompletionRunId();
    const built = buildLessonCompletionPayload({
      runId,
      lessonId: '1',
      lessonTitle: 'Lesson 1',
      entries: [entry],
      checkpoint: minimalCheckpoint('1'),
    });
    const parsed = lessonSessionCompletionPayloadSchema.safeParse(built);
    expect(parsed.success).toBe(true);
  });
});
