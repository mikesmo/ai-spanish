import { describe, expect, it } from 'vitest';
import {
  averageMasteryByPos,
  bucketPhrasesByFailedAttemptCount,
  buildGrammarItemsByMastery,
  buildPhrasesByMasterScore,
  buildWordsByMastery,
  computeLessonReportSummary,
  groupWordsByPos,
  lastHistoryDisplaySeqByPhrase,
  summarizeItemBands,
} from '../lessonReport';
import type { HistoryEntry } from '../useSessionHistory';
import type { Phrase, PhraseProgress } from '../types';
import { POS_WEIGHTS } from '../weights';
import type { ItemScore } from '../itemMastery';

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
  eventSeq?: number;
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
  eventSeq,
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
  ...(eventSeq != null ? { eventSeq } : {}),
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

describe('lastHistoryDisplaySeqByPhrase', () => {
  it('uses eventSeq when present on the last row for that phrase', () => {
    const history: HistoryEntry[] = [
      attemptEntry({ id: 'a', phraseName: 'A', isAccuracySuccess: false }),
      attemptEntry({
        id: 'b',
        phraseName: 'A',
        isAccuracySuccess: true,
        eventSeq: 900,
      }),
    ];
    expect(lastHistoryDisplaySeqByPhrase(history).get('A')).toBe(900);
  });
});

describe('bucketPhrasesByFailedAttemptCount', () => {
  it('returns empty buckets for an empty history', () => {
    const b = bucketPhrasesByFailedAttemptCount([]);
    expect(b.once).toEqual([]);
    expect(b.twice).toEqual([]);
    expect(b.threePlus).toEqual([]);
  });

  it('omits phrases with no failed scored attempts', () => {
    const b = bucketPhrasesByFailedAttemptCount([
      attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: true }),
      attemptEntry({ id: '2', phraseName: 'B', isAccuracySuccess: true }),
    ]);
    expect(b.once).toEqual([]);
    expect(b.twice).toEqual([]);
    expect(b.threePlus).toEqual([]);
  });

  it('places phrases with exactly one fail into the once bucket (may have zero revisits)', () => {
    const history: HistoryEntry[] = [
      attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: false }),
      attemptEntry({ id: '2', phraseName: 'B', isAccuracySuccess: true }),
    ];
    const b = bucketPhrasesByFailedAttemptCount(history);
    expect(b.once).toHaveLength(1);
    expect(b.once[0]?.phrase.name).toBe('A');
    expect(b.once[0]?.revisitCount).toBe(0);
    expect(b.once[0]?.failedAttempts).toBe(1);
    expect(b.once[0]?.lastEventSeq).toBe(1);
    expect(b.twice).toEqual([]);
    expect(b.threePlus).toEqual([]);
  });

  it('places phrases with one fail after one revisit into the once bucket', () => {
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
    const b = bucketPhrasesByFailedAttemptCount(history);
    expect(b.once).toHaveLength(1);
    expect(b.once[0]?.phrase.name).toBe('A');
    expect(b.once[0]?.revisitCount).toBe(1);
    expect(b.once[0]?.failedAttempts).toBe(1);
    expect(b.once[0]?.lastEventSeq).toBe(3);
    expect(b.twice).toEqual([]);
    expect(b.threePlus).toEqual([]);
  });

  it('places phrases with two fails on the same presentation into the twice bucket', () => {
    const history: HistoryEntry[] = [
      attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: false }),
      attemptEntry({ id: '2', phraseName: 'A', isAccuracySuccess: false }),
      attemptEntry({ id: '3', phraseName: 'B', isAccuracySuccess: true }),
    ];
    const b = bucketPhrasesByFailedAttemptCount(history);
    expect(b.once).toEqual([]);
    expect(b.twice).toHaveLength(1);
    expect(b.twice[0]?.phrase.name).toBe('A');
    expect(b.twice[0]?.revisitCount).toBe(0);
    expect(b.twice[0]?.failedAttempts).toBe(2);
    expect(b.twice[0]?.lastEventSeq).toBe(2);
    expect(b.threePlus).toEqual([]);
  });

  it('places phrases with exactly two fails across revisits into the twice bucket', () => {
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
    const b = bucketPhrasesByFailedAttemptCount(history);
    expect(b.once).toEqual([]);
    expect(b.twice).toHaveLength(1);
    expect(b.twice[0]?.phrase.name).toBe('A');
    expect(b.twice[0]?.revisitCount).toBe(2);
    expect(b.twice[0]?.failedAttempts).toBe(2);
    expect(b.twice[0]?.lastEventSeq).toBe(5);
    expect(b.threePlus).toEqual([]);
  });

  it('places phrases with three or more fails into the threePlus bucket', () => {
    const history: HistoryEntry[] = [];
    history.push(attemptEntry({ id: '1', phraseName: 'A', isAccuracySuccess: false }));
    history.push(attemptEntry({ id: '2', phraseName: 'A', isAccuracySuccess: false }));
    history.push(attemptEntry({ id: 'x1', phraseName: 'X', isAccuracySuccess: true }));
    history.push(
      attemptEntry({
        id: '3',
        phraseName: 'A',
        isAccuracySuccess: false,
        isRepeatedPresentation: true,
      }),
    );
    history.push(attemptEntry({ id: 'x2', phraseName: 'X', isAccuracySuccess: true }));
    history.push(
      attemptEntry({
        id: '4',
        phraseName: 'A',
        isAccuracySuccess: true,
        isRepeatedPresentation: true,
      }),
    );
    const b = bucketPhrasesByFailedAttemptCount(history);
    expect(b.once).toEqual([]);
    expect(b.twice).toEqual([]);
    expect(b.threePlus).toHaveLength(1);
    expect(b.threePlus[0]?.phrase.name).toBe('A');
    expect(b.threePlus[0]?.revisitCount).toBe(2);
    expect(b.threePlus[0]?.failedAttempts).toBe(3);
    expect(b.threePlus[0]?.lastEventSeq).toBe(6);
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
    expect(rows.map((r) => r.lastEventSeq)).toEqual([2, 3, 1]);
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
    expect(rows[0]?.lastEventSeq).toBe(2);
    expect(rows[1]?.phrase.name).toBe('A');
    expect(rows[1]?.lastEventSeq).toBe(1);
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
    expect(rows[0]?.lastEventSeq).toBe(1);
  });
});

// ─── buildWordsByMastery ──────────────────────────────────────────────────────

const makeScore = (mastery: number, trialsEff = 5): ItemScore => ({
  mastery,
  trialsEff,
  successSumEff: trialsEff * mastery,
  stability: mastery,
  lastUpdatedAtEventSeq: 1,
});

const phraseWithWords = (
  name: string,
  wordDefs: Array<{ word: string; type: 'verb' | 'noun' | 'preposition' }>,
): Phrase => ({
  name,
  index: 0,
  English: { 'first-intro': '', 'second-intro': '', question: name, 'follow-up': '', explain: '' },
  Spanish: {
    grammar: 'polite address',
    answer: wordDefs.map((w) => w.word).join(' '),
    words: wordDefs.map((w) => ({ word: w.word, type: w.type, weight: POS_WEIGHTS[w.type] })),
  },
});

const entryForPhrase = (id: string, p: Phrase): HistoryEntry => ({
  id,
  event: {
    eventType: 'attempt',
    phraseId: p.name,
    transcript: [],
    missingWords: [],
    extraWords: [],
    accuracyScore: 0.9,
    fluencyScore: 0.8,
    isAccuracySuccess: true,
    success: true,
    timestamp: 0,
    accuracyBreakdown: { accuracy: 0.9, totalWeight: 1, missingPenalty: 0, extraPenalty: 0, rawExtraPenalty: 0 },
    fluencyBreakdown: null,
  },
  phrase: p,
  scoreSummary: { accuracy: 0.9, fluency: 0.8, mastery: 0.7, isAccuracySuccess: true },
  stabilityBreakdown: { before: 0, after: 0.5, kind: 'attempt_ema', emaInput: 1 },
  masteryBefore: 0,
  masteryAfter: 0.7,
  isRepeatedPresentation: false,
  slotsAheadAtEvent: null,
});

describe('buildWordsByMastery', () => {
  it('returns empty array for empty history', () => {
    expect(buildWordsByMastery([], {})).toEqual([]);
  });

  it('marks a word as untrained when it has no score entry', () => {
    const p = phraseWithWords('p1', [{ word: 'Perdón', type: 'noun' }]);
    const rows = buildWordsByMastery([entryForPhrase('e1', p)], {});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isUntrained).toBe(true);
    expect(rows[0]?.mastery).toBe(0);
    expect(rows[0]?.word).toBe('perdon'); // normalized
  });

  it('merges the same word appearing in two phrases into one row with both phraseIds', () => {
    const p1 = phraseWithWords('p1', [{ word: 'Perdón', type: 'noun' }]);
    const p2 = phraseWithWords('p2', [{ word: 'perdón', type: 'noun' }]);
    const rows = buildWordsByMastery(
      [entryForPhrase('e1', p1), entryForPhrase('e2', p2)],
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appearedInPhraseIds.sort()).toEqual(['p1', 'p2']);
  });

  it('sorts trained rows by mastery ascending with untrained rows last', () => {
    const p = phraseWithWords('p1', [
      { word: 'hablo', type: 'verb' },
      { word: 'poco', type: 'noun' },
    ]);
    const scores: Record<string, ItemScore> = {
      hablo: makeScore(0.8),
      poco: makeScore(0.3),
    };
    const rows = buildWordsByMastery([entryForPhrase('e1', p)], scores);
    expect(rows.map((r) => r.word)).toEqual(['poco', 'hablo']);
    expect(rows.every((r) => !r.isUntrained)).toBe(true);
  });

  it('places untrained rows after all trained rows', () => {
    const p = phraseWithWords('p1', [
      { word: 'hablo', type: 'verb' },
      { word: 'inglés', type: 'noun' },
    ]);
    const rows = buildWordsByMastery([entryForPhrase('e1', p)], { hablo: makeScore(0.5) });
    expect(rows[0]?.word).toBe('hablo');
    expect(rows[1]?.isUntrained).toBe(true);
  });
});

// ─── groupWordsByPos ─────────────────────────────────────────────────────────

describe('groupWordsByPos', () => {
  it('partitions rows by type, omitting empty POS', () => {
    const p = phraseWithWords('p1', [
      { word: 'hablo', type: 'verb' },
      { word: 'Inglés', type: 'noun' },
    ]);
    const rows = buildWordsByMastery([entryForPhrase('e1', p)], {});
    const grouped = groupWordsByPos(rows);
    expect(Object.keys(grouped).sort()).toEqual(['noun', 'verb']);
    expect(grouped.verb).toHaveLength(1);
    expect(grouped.noun).toHaveLength(1);
  });
});

// ─── buildGrammarItemsByMastery ──────────────────────────────────────────────

const phraseWithGrammar = (name: string, grammar: string): Phrase => ({
  name,
  index: 0,
  English: { 'first-intro': '', 'second-intro': '', question: name, 'follow-up': '', explain: '' },
  Spanish: {
    grammar,
    answer: 'test',
    words: [{ word: 'test', type: 'verb', weight: POS_WEIGHTS.verb }],
  },
});

describe('buildGrammarItemsByMastery', () => {
  it('returns empty array for empty history', () => {
    expect(buildGrammarItemsByMastery([], {}, [])).toEqual([]);
  });

  it('marks a grammar item as untrained when no score exists', () => {
    const p = phraseWithGrammar('p1', 'polite address');
    const rows = buildGrammarItemsByMastery([entryForPhrase('e1', p)], {}, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.item).toBe('polite address');
    expect(rows[0]?.isUntrained).toBe(true);
  });

  it('splits comma-separated grammar items into separate rows', () => {
    const p = phraseWithGrammar('p1', 'verb conjugation, subject pronoun');
    const rows = buildGrammarItemsByMastery([entryForPhrase('e1', p)], {}, []);
    expect(rows.map((r) => r.item).sort()).toEqual(['subject pronoun', 'verb conjugation']);
  });

  it('deduplicates grammar items appearing in multiple phrases', () => {
    const p1 = phraseWithGrammar('p1', 'polite address');
    const p2 = phraseWithGrammar('p2', 'polite address');
    const rows = buildGrammarItemsByMastery(
      [entryForPhrase('e1', p1), entryForPhrase('e2', p2)],
      {},
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.phraseIds.sort()).toEqual(['p1', 'p2']);
  });

  it('attaches the latest rationale from incorrectPhraseRecords', () => {
    const p = phraseWithGrammar('p1', 'polite address');
    const record = {
      phraseId: 'p1',
      incorrectWords: [],
      resolvedWords: [],
      incorrectGrammarItems: [
        {
          item: 'polite address',
          failedAtEventSeq: 3,
          resolvedByEventSeq: null as number | null,
          rationale: 'Missing accent on perdón',
        },
      ],
      incorrectWordEntries: [],
      grammarGradingStatus: 'success' as const,
      failedAtEventSeq: 3,
      isFullyResolved: false,
    };
    const rows = buildGrammarItemsByMastery([entryForPhrase('e1', p)], {}, [record]);
    expect(rows[0]?.latestRationale).toBe('Missing accent on perdón');
  });

  it('sorts by mastery ascending, untrained rows last', () => {
    const p = phraseWithGrammar('p1', 'verb conjugation, polite address');
    const scores: Record<string, ItemScore> = {
      'verb conjugation': makeScore(0.9),
      'polite address': makeScore(0.4),
    };
    const rows = buildGrammarItemsByMastery([entryForPhrase('e1', p)], scores, []);
    expect(rows[0]?.item).toBe('polite address');
    expect(rows[1]?.item).toBe('verb conjugation');
  });
});

// ─── summarizeItemBands ──────────────────────────────────────────────────────

describe('summarizeItemBands', () => {
  it('returns all-zero summary for empty input', () => {
    const s = summarizeItemBands([]);
    expect(s).toEqual({ weak: 0, stabilizing: 0, mastered: 0, untrained: 0, total: 0 });
  });

  it('counts untrained separately and classifies trained rows by band', () => {
    const rows = [
      { mastery: 0.1, isUntrained: false },  // weak
      { mastery: 0.6, isUntrained: false },  // stabilizing
      { mastery: 0.95, isUntrained: false }, // mastered
      { mastery: 0, isUntrained: true },     // untrained
    ];
    const s = summarizeItemBands(rows);
    expect(s.weak).toBe(1);
    expect(s.stabilizing).toBe(1);
    expect(s.mastered).toBe(1);
    expect(s.untrained).toBe(1);
    expect(s.total).toBe(4);
  });
});

// ─── averageMasteryByPos ─────────────────────────────────────────────────────

describe('averageMasteryByPos', () => {
  it('returns empty object for empty input', () => {
    expect(averageMasteryByPos([])).toEqual({});
  });

  it('averages mastery per part of speech, excluding untrained rows', () => {
    const p1 = phraseWithWords('p1', [
      { word: 'hablo', type: 'verb' },
      { word: 'ingles', type: 'noun' },
    ]);
    const p2 = phraseWithWords('p2', [{ word: 'como', type: 'verb' }]);
    const scores: Record<string, ItemScore> = {
      hablo: makeScore(0.8),
      ingles: makeScore(0.6),
      como: makeScore(0.4),
    };
    const rows = buildWordsByMastery(
      [entryForPhrase('e1', p1), entryForPhrase('e2', p2)],
      scores,
    );
    const avgs = averageMasteryByPos(rows);
    expect(avgs.verb).toBeCloseTo((0.8 + 0.4) / 2);
    expect(avgs.noun).toBeCloseTo(0.6);
  });

  it('returns null for a POS where all rows are untrained', () => {
    const p = phraseWithWords('p1', [{ word: 'hablo', type: 'verb' }]);
    const rows = buildWordsByMastery([entryForPhrase('e1', p)], {});
    const avgs = averageMasteryByPos(rows);
    expect(avgs.verb).toBeNull();
  });
});
