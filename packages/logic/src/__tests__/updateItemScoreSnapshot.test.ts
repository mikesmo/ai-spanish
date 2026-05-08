import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../useSessionHistory';
import type { ItemScore } from '../itemMastery';
import type { Phrase } from '../types';
import { POS_WEIGHTS } from '../weights';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePhrase = (name: string): Phrase => ({
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

const makeScore = (mastery: number, trialsEff = 1): ItemScore => ({
  mastery,
  trialsEff,
  successSumEff: mastery * trialsEff,
  stability: mastery,
  lastUpdatedAtEventSeq: 1,
});

const makeEntry = (id: string, eventSeq: number): HistoryEntry => ({
  id,
  event: {
    eventType: 'attempt',
    phraseId: id,
    transcript: [],
    missingWords: [],
    extraWords: [],
    accuracyScore: 0.9,
    fluencyScore: null,
    isAccuracySuccess: true,
    success: true,
    timestamp: 0,
    accuracyBreakdown: {
      accuracy: 0.9,
      totalWeight: 1,
      missingPenalty: 0,
      extraPenalty: 0,
      rawExtraPenalty: 0,
    },
    fluencyBreakdown: null,
  },
  phrase: makePhrase(id),
  scoreSummary: { accuracy: 0.9, fluency: null, mastery: 0.7, isAccuracySuccess: true },
  stabilityBreakdown: { before: 0.5, after: 0.6, kind: 'attempt_ema', emaInput: 1 },
  masteryBefore: 0.5,
  masteryAfter: 0.7,
  isRepeatedPresentation: false,
  slotsAheadAtEvent: null,
  eventSeq,
  gradingStatus: 'success',
});

// ---------------------------------------------------------------------------
// Pure patch logic (mirrors the setHistory updater in updateItemScoreSnapshot)
// ---------------------------------------------------------------------------

function applySnapshotPatch(
  history: HistoryEntry[],
  eventSeq: number,
  wordScoreSnapshot: Record<string, ItemScore>,
  grammarItemScoreSnapshot: Record<string, ItemScore>,
): HistoryEntry[] {
  return history.map((entry) => {
    if (entry.eventSeq !== eventSeq) return entry;
    return { ...entry, wordScoreSnapshot, grammarItemScoreSnapshot };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateItemScoreSnapshot patch logic', () => {
  it('patches the entry with matching eventSeq', () => {
    const history = [makeEntry('phraseA', 1), makeEntry('phraseB', 2)];
    const wordSnapshot = { hablo: makeScore(0.75, 3) };
    const grammarSnapshot = { 'ser identity': makeScore(0.5, 2) };

    const patched = applySnapshotPatch(history, 1, wordSnapshot, grammarSnapshot);

    expect(patched[0]?.wordScoreSnapshot).toEqual(wordSnapshot);
    expect(patched[0]?.grammarItemScoreSnapshot).toEqual(grammarSnapshot);
  });

  it('leaves entries with non-matching eventSeq unchanged', () => {
    const history = [makeEntry('phraseA', 1), makeEntry('phraseB', 2)];
    const wordSnapshot = { hablo: makeScore(0.75, 3) };
    const grammarSnapshot = {};

    const patched = applySnapshotPatch(history, 1, wordSnapshot, grammarSnapshot);

    expect(patched[1]).toBe(history[1]);
    expect(patched[1]?.wordScoreSnapshot).toBeUndefined();
    expect(patched[1]?.grammarItemScoreSnapshot).toBeUndefined();
  });

  it('does not mutate the original history array', () => {
    const history = [makeEntry('phraseA', 1)];
    const original = history[0];
    const wordSnapshot = { hablo: makeScore(0.75, 3) };

    applySnapshotPatch(history, 1, wordSnapshot, {});

    expect(history[0]).toBe(original);
    expect(original.wordScoreSnapshot).toBeUndefined();
  });

  it('handles a history with no matching eventSeq gracefully', () => {
    const history = [makeEntry('phraseA', 1), makeEntry('phraseB', 2)];
    const patched = applySnapshotPatch(history, 99, { hablo: makeScore(0.5) }, {});

    expect(patched[0]).toBe(history[0]);
    expect(patched[1]).toBe(history[1]);
  });

  it('preserves all other entry fields on the patched entry', () => {
    const history = [makeEntry('phraseA', 5)];
    const patched = applySnapshotPatch(history, 5, { hola: makeScore(0.8) }, {});

    const entry = patched[0]!;
    expect(entry.id).toBe('phraseA');
    expect(entry.eventSeq).toBe(5);
    expect(entry.masteryAfter).toBe(0.7);
    expect(entry.gradingStatus).toBe('success');
  });
});
