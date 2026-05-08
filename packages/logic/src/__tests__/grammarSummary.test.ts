import { describe, expect, it } from 'vitest';
import { selectGrammarItemsForSummary, buildGrammarSummaryPrompts } from '../grammarSummary';
import { buildGrammarItemsByMastery } from '../lessonReport';
import {
  lessonSessionCompletionPayloadSchema,
} from '../schemas/lessonSessionCompletion';
import { grammarSummarySchema } from '../schemas/grammarSummary';
import type { GrammarMasteryRow } from '../lessonReport';
import type { HistoryEntry } from '../useSessionHistory';
import type { Phrase } from '../types';
import type { ItemScore } from '../itemMastery';
import { POS_WEIGHTS } from '../weights';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeScore = (mastery: number, trialsEff = 5): ItemScore => ({
  mastery,
  trialsEff,
  successSumEff: mastery * trialsEff,
  stability: mastery,
  lastUpdatedAtEventSeq: 1,
});

const makeGrammarRow = (
  item: string,
  mastery: number,
  trialsEff = 5,
): GrammarMasteryRow => ({
  item,
  mastery,
  trialsEff,
  stability: mastery,
  lastUpdatedAtEventSeq: 1,
  phraseIds: ['p1'],
  isUntrained: false,
});

const phraseWithGrammar = (name: string, grammar: string): Phrase => ({
  name,
  index: 0,
  English: {
    'first-intro': '',
    'second-intro': '',
    question: `Question about ${name}`,
    'follow-up': '',
    explain: '',
  },
  Spanish: {
    grammar,
    answer: `${name} answer`,
    words: [{ word: name, type: 'verb', weight: POS_WEIGHTS.verb }],
  },
});

const makeAttemptEntry = (
  id: string,
  phrase: Phrase,
  overrides: Partial<HistoryEntry> = {},
): HistoryEntry => ({
  id,
  event: {
    eventType: 'attempt',
    phraseId: phrase.name,
    transcript: ['Perdón'],
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
  phrase,
  scoreSummary: { accuracy: 0.9, fluency: null, mastery: 0.5, isAccuracySuccess: true },
  stabilityBreakdown: { before: 0.3, after: 0.5, kind: 'attempt_ema', emaInput: 1 },
  masteryBefore: 0.3,
  masteryAfter: 0.5,
  isRepeatedPresentation: false,
  slotsAheadAtEvent: null,
  gradingStatus: 'success',
  ...overrides,
});

// ---------------------------------------------------------------------------
// selectGrammarItemsForSummary
// ---------------------------------------------------------------------------

describe('selectGrammarItemsForSummary', () => {
  it('returns an empty array when there are no eligible items', () => {
    expect(selectGrammarItemsForSummary([])).toEqual([]);
  });

  it('excludes untrained items', () => {
    const row: GrammarMasteryRow = {
      ...makeGrammarRow('formal usted', 0.3),
      isUntrained: true,
    };
    expect(selectGrammarItemsForSummary([row])).toHaveLength(0);
  });

  it('excludes items below the trialsEff threshold (< 3)', () => {
    const row = makeGrammarRow('polite address', 0.3, 2.5);
    expect(selectGrammarItemsForSummary([row])).toHaveLength(0);
  });

  it('excludes mastered items', () => {
    const row = makeGrammarRow('ser identity', 0.85, 6);
    expect(selectGrammarItemsForSummary([row])).toHaveLength(0);
  });

  it('includes weak items (mastery < 0.6) with trialsEff >= 3', () => {
    const row = makeGrammarRow('polite address', 0.4, 4);
    const result = selectGrammarItemsForSummary([row]);
    expect(result).toHaveLength(1);
    expect(result[0]?.item).toBe('polite address');
  });

  it('includes stabilizing items (0.6 <= mastery < 0.8) with trialsEff >= 3', () => {
    const row = makeGrammarRow('verb conjugation', 0.65, 5);
    const result = selectGrammarItemsForSummary([row]);
    expect(result).toHaveLength(1);
    expect(result[0]?.item).toBe('verb conjugation');
  });

  it('returns at most 3 items', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      makeGrammarRow(`item ${i}`, 0.3 + i * 0.01, 5),
    );
    expect(selectGrammarItemsForSummary(rows)).toHaveLength(3);
  });

  it('sorts ascending by mastery (lowest first)', () => {
    const rows = [
      makeGrammarRow('C', 0.7, 5),
      makeGrammarRow('A', 0.4, 5),
      makeGrammarRow('B', 0.55, 5),
    ];
    const result = selectGrammarItemsForSummary(rows);
    expect(result.map((r) => r.item)).toEqual(['A', 'B', 'C']);
  });

  it('integrates correctly with buildGrammarItemsByMastery output', () => {
    const p1 = phraseWithGrammar('p1', 'polite address, ser vs estar');
    const p2 = phraseWithGrammar('p2', 'polite address');
    const scores: Record<string, ItemScore> = {
      'polite address': makeScore(0.45, 4),
      'ser vs estar': makeScore(0.72, 4),
    };
    const entry1 = makeAttemptEntry('e1', p1);
    const entry2 = makeAttemptEntry('e2', p2);
    const rows = buildGrammarItemsByMastery([entry1, entry2], scores, []);
    const selected = selectGrammarItemsForSummary(rows);
    expect(selected.map((r) => r.item)).toContain('polite address');
    expect(selected.map((r) => r.item)).toContain('ser vs estar');
  });
});

// ---------------------------------------------------------------------------
// buildGrammarSummaryPrompts
// ---------------------------------------------------------------------------

describe('buildGrammarSummaryPrompts', () => {
  const grammar = 'polite address';
  const p = phraseWithGrammar('p1', grammar);
  const entry = makeAttemptEntry('e1', p);
  const row = makeGrammarRow(grammar, 0.45);

  it('returns non-empty systemPrompt and userPrompt', () => {
    const { systemPrompt, userPrompt } = buildGrammarSummaryPrompts(grammar, row, [entry]);
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(userPrompt.length).toBeGreaterThan(0);
  });

  it('includes the grammar item name in the user prompt', () => {
    const { userPrompt } = buildGrammarSummaryPrompts(grammar, row, [entry]);
    expect(userPrompt).toContain(grammar);
  });

  it('includes mastery percentage in user prompt', () => {
    const { userPrompt } = buildGrammarSummaryPrompts(grammar, row, [entry]);
    expect(userPrompt).toContain('45%');
  });

  it('guides the model to vary phrasing and add examples only when helpful', () => {
    const { systemPrompt } = buildGrammarSummaryPrompts(grammar, row, [entry]);
    expect(systemPrompt).toContain('Vary your sentence openings');
    expect(systemPrompt).toContain('include a brief example or contrast');
    expect(systemPrompt).toContain('Skip examples when they would feel forced');
  });

  it('only includes history entries that contain the grammar item', () => {
    const otherPhrase = phraseWithGrammar('p2', 'ser vs estar');
    const otherEntry = makeAttemptEntry('e2', otherPhrase);
    const { userPrompt } = buildGrammarSummaryPrompts(
      grammar,
      row,
      [entry, otherEntry],
    );
    // Only the matching phrase's snippet appears in the prompt.
    expect(userPrompt).toContain('Snippet 1');
    expect(userPrompt).not.toContain('Snippet 2');
  });

  it('includes expected Spanish in the user prompt', () => {
    const { userPrompt } = buildGrammarSummaryPrompts(grammar, row, [entry]);
    expect(userPrompt).toContain(p.Spanish.answer);
  });

  it('includes transcript in the user prompt', () => {
    const { userPrompt } = buildGrammarSummaryPrompts(grammar, row, [entry]);
    expect(userPrompt).toContain('Perdón');
  });

  it('includes the AI rationale when available', () => {
    const entryWithRationale = makeAttemptEntry('e1', p, {
      aiClassification: {
        failedGrammarItems: [{ item: grammar, rationale: 'Used informal form.' }],
        wordMistakes: [],
      },
    });
    const { userPrompt } = buildGrammarSummaryPrompts(grammar, row, [entryWithRationale]);
    expect(userPrompt).toContain('Used informal form.');
  });

  it('omits rationale for a different grammar item', () => {
    const entryWithOtherRationale = makeAttemptEntry('e1', p, {
      aiClassification: {
        failedGrammarItems: [{ item: 'ser vs estar', rationale: 'Wrong verb.' }],
        wordMistakes: [],
      },
    });
    const { userPrompt } = buildGrammarSummaryPrompts(grammar, row, [entryWithOtherRationale]);
    expect(userPrompt).not.toContain('Wrong verb.');
  });

  it('handles answer-first moments in the history', () => {
    const revealEntry: HistoryEntry = {
      ...makeAttemptEntry('e1', p),
      event: {
        eventType: 'reveal',
        phraseId: p.name,
        penaltyApplied: true,
        timestamp: 0,
      },
      scoreSummary: null,
    };
    const { userPrompt } = buildGrammarSummaryPrompts(grammar, row, [revealEntry]);
    expect(userPrompt).toContain('viewed the answer before speaking');
    expect(userPrompt).toContain('chose to see the full answer');
  });

  it('mentions zero snippets gracefully when no trail exists', () => {
    const { userPrompt } = buildGrammarSummaryPrompts(grammar, row, []);
    expect(userPrompt).toContain('0 snippets');
  });
});

// ---------------------------------------------------------------------------
// Schema backward compatibility
// ---------------------------------------------------------------------------

describe('lessonSessionCompletionPayloadSchema backward compatibility', () => {
  const minimalCheckpoint = {
    schemaVersion: 1 as const,
    lessonId: '1',
    queuePhraseIds: [],
    currentPresentedPhraseId: null,
    reinsertCount: {},
    progress: [],
  };

  const basePayload = {
    schemaVersion: 1 as const,
    runId: 'run-1234567890',
    lessonId: '1',
    completedAtMs: 0,
    entries: [],
    checkpoint: minimalCheckpoint,
  };

  it('parses a payload without grammarSummaries (legacy)', () => {
    const result = lessonSessionCompletionPayloadSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.grammarSummaries).toBeUndefined();
    }
  });

  it('parses a payload with grammarSummaries attached', () => {
    const withSummaries = {
      ...basePayload,
      grammarSummaries: [
        {
          item: 'polite address',
          mastery: 0.45,
          band: 'weak',
          trialsEff: 4,
          attemptCount: 2,
          status: 'success',
          struggling: 'You tend to use informal forms.',
          focus: 'Practice the formal usted forms.',
        },
      ],
    };
    const result = lessonSessionCompletionPayloadSchema.safeParse(withSummaries);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.grammarSummaries).toHaveLength(1);
      expect(result.data.grammarSummaries?.[0]?.item).toBe('polite address');
    }
  });

  it('parses a summary with status=error and no struggling/focus', () => {
    const errorSummary = {
      item: 'ser vs estar',
      mastery: 0.5,
      band: 'stabilizing',
      trialsEff: 3,
      attemptCount: 1,
      status: 'error',
      errorReason: 'Timeout',
    };
    const result = grammarSummarySchema.safeParse(errorSummary);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('error');
      expect(result.data.struggling).toBeUndefined();
      expect(result.data.focus).toBeUndefined();
    }
  });
});
