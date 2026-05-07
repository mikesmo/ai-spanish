import { describe, expect, it } from 'vitest';
import {
  bucketPhrasesByRevisitCount,
  buildPhrasesByMasterScore,
  computeLessonReportSummary,
} from '../lessonReport';
import type { HistoryEntry } from '../useSessionHistory';
import type { Phrase, PhraseProgress } from '../types';
import { POS_WEIGHTS } from '../weights';

const phrase = (name: string): Phrase => ({
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
    words: [{ word: name, type: 'verb', weight: POS_WEIGHTS.verb }],
  },
});

interface AttemptEntryArgs {
  id: string;
  phraseName: string;
  isAccuracySuccess: boolean;
  success?: boolean;
  isRepeatedPresentation?: boolean;
  accuracy?: number;
  fluency?: number | null;
  mastery?: number;
}

const attemptEntry = ({
  id,
  phraseName,
  isAccuracySuccess,
  success = isAccuracySuccess,
  isRepeatedPresentation = false,
  accuracy = isAccuracySuccess ? 0.95 : 0.4,
  fluency = 0.8,
  mastery = isAccuracySuccess ? 0.7 : 0.2,
}: AttemptEntryArgs): HistoryEntry => ({
  id,
  event: {
    eventType: 'attempt',
    phraseId: phraseName,
    transcript: [],
    missingWords: [],
    extraWords: [],
    accuracyScore: accuracy,
    fluencyScore: fluency,
    isAccuracySuccess,
    success,
    timestamp: 0,
    accuracyBreakdown: {
      accuracy,
      totalWeight: 1,
      missingPenalty: 0,
      extraPenalty: 0,
      rawExtraPenalty: 0,
    },
    fluencyBreakdown:
      fluency == null
        ? null
        : {
            speedScore: fluency,
            pauseScore: fluency,
            gapConsistencyScore: fluency,
            fluencyScore: fluency,
            wordsPerSecond: 2,
            longPauses: 0,
          },
  },
  phrase: phrase(phraseName),
  scoreSummary: {
    accuracy,
    fluency,
    mastery,
    isAccuracySuccess,
  },
  stabilityBreakdown: {
    before: 0,
    after: 0.3,
    kind: 'attempt_ema',
    emaInput: isAccuracySuccess ? 1 : 0,
  },
  masteryBefore: 0,
  masteryAfter: mastery,
  isRepeatedPresentation,
  slotsAheadAtEvent: null,
});

const practiceEntry = (id: string, phraseName: string): HistoryEntry => ({
  id,
  event: {
    eventType: 'practice',
    phraseId: phraseName,
    transcript: [],
    fluencyScore: null,
    timestamp: 0,
    accuracyBreakdown: {
      accuracy: 0.5,
      totalWeight: 1,
      missingPenalty: 0,
      extraPenalty: 0,
      rawExtraPenalty: 0,
    },
    fluencyBreakdown: null,
  },
  phrase: phrase(phraseName),
  scoreSummary: null,
  stabilityBreakdown: { before: 0, after: 0, kind: 'practice_unchanged' },
  masteryBefore: 0,
  masteryAfter: 0,
  isRepeatedPresentation: false,
  slotsAheadAtEvent: null,
});

const revealEntry = (id: string, phraseName: string): HistoryEntry => ({
  id,
  event: {
    eventType: 'reveal',
    phraseId: phraseName,
    penaltyApplied: true,
    timestamp: 0,
  },
  phrase: phrase(phraseName),
  scoreSummary: null,
  stabilityBreakdown: { before: 0.5, after: 0.35, kind: 'reveal_decay' },
  masteryBefore: 0.5,
  masteryAfter: 0.3,
  isRepeatedPresentation: false,
  slotsAheadAtEvent: null,
});

describe('computeLessonReportSummary', () => {
  it('returns zeroed summary for an empty history', () => {
    const summary = computeLessonReportSummary([]);
    expect(summary.totalEvents).toBe(0);
    expect(summary.totalAttempts).toBe(0);
    expect(summary.exactCorrect).toBe(0);
    expect(summary.exactCorrectPct).toBeNull();
    expect(summary.avgAccuracy).toBeNull();
    expect(summary.avgFluency).toBeNull();
    expect(summary.practiceCount).toBe(0);
    expect(summary.revealCount).toBe(0);
    expect(summary.revisitAttemptCount).toBe(0);
  });

  it('counts attempts, exacts, retries, reveals, and revisit attempts', () => {
    const history: HistoryEntry[] = [
      attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: true, success: true }),
      attemptEntry({ id: '2', phraseName: 'B', isAccuracySuccess: false, success: false }),
      practiceEntry('3', 'B'),
      revealEntry('4', 'C'),
      attemptEntry({
        id: '5',
        phraseName: 'B',
        isAccuracySuccess: true,
        success: false,
        isRepeatedPresentation: true,
      }),
    ];
    const s = computeLessonReportSummary(history);
    expect(s.totalEvents).toBe(5);
    expect(s.totalAttempts).toBe(3);
    expect(s.exactCorrect).toBe(1);
    expect(s.exactCorrectPct).toBeCloseTo(1 / 3);
    expect(s.practiceCount).toBe(1);
    expect(s.revealCount).toBe(1);
    expect(s.revisitAttemptCount).toBe(1);
    expect(s.avgAccuracy).toBeCloseTo((0.95 + 0.4 + 0.95) / 3);
    expect(s.avgFluency).toBeCloseTo(0.8);
  });
});

describe('bucketPhrasesByRevisitCount', () => {
  it('returns empty buckets for an empty history', () => {
    const b = bucketPhrasesByRevisitCount([]);
    expect(b.once).toEqual([]);
    expect(b.twice).toEqual([]);
    expect(b.threePlus).toEqual([]);
  });

  it('omits phrases that were never revisited', () => {
    const b = bucketPhrasesByRevisitCount([
      attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: true }),
      attemptEntry({ id: '2', phraseName: 'B', isAccuracySuccess: true }),
    ]);
    expect(b.once).toEqual([]);
    expect(b.twice).toEqual([]);
    expect(b.threePlus).toEqual([]);
  });

  it('places phrases revisited once into the once bucket', () => {
    const history: HistoryEntry[] = [
      attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: false }),
      attemptEntry({ id: '2', phraseName: 'B', isAccuracySuccess: true }),
      attemptEntry({
        id: '3',
        phraseName: 'A',
        isAccuracySuccess: true,
        isRepeatedPresentation: true,
      }),
    ];
    const b = bucketPhrasesByRevisitCount(history);
    expect(b.once).toHaveLength(1);
    expect(b.once[0]?.phrase.name).toBe('A');
    expect(b.once[0]?.revisitCount).toBe(1);
    expect(b.once[0]?.failedAttempts).toBe(1);
    expect(b.twice).toEqual([]);
    expect(b.threePlus).toEqual([]);
  });

  it('places phrases revisited twice into the twice bucket', () => {
    const history: HistoryEntry[] = [
      attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: false }),
      attemptEntry({ id: '2', phraseName: 'B', isAccuracySuccess: true }),
      attemptEntry({
        id: '3',
        phraseName: 'A',
        isAccuracySuccess: false,
        isRepeatedPresentation: true,
      }),
      attemptEntry({ id: '4', phraseName: 'C', isAccuracySuccess: true }),
      attemptEntry({
        id: '5',
        phraseName: 'A',
        isAccuracySuccess: true,
        isRepeatedPresentation: true,
      }),
    ];
    const b = bucketPhrasesByRevisitCount(history);
    expect(b.once).toEqual([]);
    expect(b.twice).toHaveLength(1);
    expect(b.twice[0]?.phrase.name).toBe('A');
    expect(b.twice[0]?.revisitCount).toBe(2);
    expect(b.twice[0]?.failedAttempts).toBe(2);
  });

  it('places phrases revisited 3+ times into the threePlus bucket', () => {
    const history: HistoryEntry[] = [];
    history.push(attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: false }));
    history.push(attemptEntry({ id: 'x1', phraseName: 'X', isAccuracySuccess: true }));
    history.push(
      attemptEntry({
        id: '2',
        phraseName: 'A',
        isAccuracySuccess: false,
        isRepeatedPresentation: true,
      }),
    );
    history.push(attemptEntry({ id: 'x2', phraseName: 'X', isAccuracySuccess: true }));
    history.push(
      attemptEntry({
        id: '3',
        phraseName: 'A',
        isAccuracySuccess: false,
        isRepeatedPresentation: true,
      }),
    );
    history.push(attemptEntry({ id: 'x3', phraseName: 'X', isAccuracySuccess: true }));
    history.push(
      attemptEntry({
        id: '4',
        phraseName: 'A',
        isAccuracySuccess: true,
        isRepeatedPresentation: true,
      }),
    );
    const b = bucketPhrasesByRevisitCount(history);
    expect(b.threePlus).toHaveLength(1);
    expect(b.threePlus[0]?.phrase.name).toBe('A');
    expect(b.threePlus[0]?.revisitCount).toBe(3);
    expect(b.threePlus[0]?.failedAttempts).toBe(3);
  });
});

describe('buildPhrasesByMasterScore', () => {
  it('returns rows sorted ascending by masteryScore', () => {
    const history: HistoryEntry[] = [
      attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: true }),
      attemptEntry({ id: '2', phraseName: 'B', isAccuracySuccess: false }),
      attemptEntry({ id: '3', phraseName: 'C', isAccuracySuccess: true }),
    ];
    const progress: PhraseProgress[] = [
      { phraseId: 'A', masteryScore: 0.9, stabilityScore: 0.8, state: 'mastered', lastSeenAt: 0 },
      { phraseId: 'B', masteryScore: 0.2, stabilityScore: 0.1, state: 'learning', lastSeenAt: 0 },
      { phraseId: 'C', masteryScore: 0.5, stabilityScore: 0.4, state: 'stabilizing', lastSeenAt: 0 },
    ];
    const rows = buildPhrasesByMasterScore(history, progress);
    expect(rows.map((r) => r.phrase.name)).toEqual(['B', 'C', 'A']);
    expect(rows.map((r) => r.masteryScore)).toEqual([0.2, 0.5, 0.9]);
  });

  it('synthesizes a 0-mastery row for phrases without progress', () => {
    const history: HistoryEntry[] = [
      attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: true }),
      attemptEntry({ id: '2', phraseName: 'Z', isAccuracySuccess: true }),
    ];
    const progress: PhraseProgress[] = [
      { phraseId: 'A', masteryScore: 0.7, stabilityScore: 0.5, state: 'stabilizing', lastSeenAt: 0 },
    ];
    const rows = buildPhrasesByMasterScore(history, progress);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.phrase.name).toBe('Z');
    expect(rows[0]?.masteryScore).toBe(0);
    expect(rows[0]?.state).toBe('new');
    expect(rows[1]?.phrase.name).toBe('A');
  });

  it('ignores progress entries that have no matching history phrase', () => {
    const history: HistoryEntry[] = [
      attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: true }),
    ];
    const progress: PhraseProgress[] = [
      { phraseId: 'A', masteryScore: 0.9, stabilityScore: 0.8, state: 'mastered', lastSeenAt: 0 },
      { phraseId: 'GHOST', masteryScore: 0.1, stabilityScore: 0.1, state: 'learning', lastSeenAt: 0 },
    ];
    const rows = buildPhrasesByMasterScore(history, progress);
    expect(rows.map((r) => r.phrase.name)).toEqual(['A']);
  });
});
