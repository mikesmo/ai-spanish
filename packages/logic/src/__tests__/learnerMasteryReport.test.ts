import { describe, expect, it } from 'vitest';
import {
  buildLifetimeGrammarMasteryRows,
  buildLifetimeMasteryRows,
  buildLifetimeWordMasteryRows,
} from '../learnerMasteryReport';
import type { ItemScore } from '../itemMastery';
import type { LearnerMasterySnapshot } from '../schemas/learnerMastery';

const score = (overrides: Partial<ItemScore> = {}): ItemScore => ({
  trialsEff: 4,
  successSumEff: 3,
  stability: 0.6,
  mastery: 0.65,
  lastUpdatedAtEventSeq: 1,
  ...overrides,
});

describe('buildLifetimeMasteryRows', () => {
  it('builds a practiced-only row from the score map', () => {
    const rows = buildLifetimeMasteryRows({ hola: score({ mastery: 0.7 }) }, {});
    expect(rows).toEqual([
      {
        key: 'hola',
        mastery: 0.7,
        trialsEff: 4,
        stability: 0.6,
        isUntrained: false,
        claimedLevel: undefined,
      },
    ]);
  });

  it('builds a claimed-but-unpracticed row with zeroed stats when there is no score entry', () => {
    const rows = buildLifetimeMasteryRows({}, { adios: 'A1' });
    expect(rows).toEqual([
      {
        key: 'adios',
        mastery: 0,
        trialsEff: 0,
        stability: 0,
        isUntrained: true,
        claimedLevel: 'A1',
      },
    ]);
  });

  it('merges a key that is both claimed and practiced into a single row', () => {
    const rows = buildLifetimeMasteryRows(
      { gracias: score({ mastery: 0.9, trialsEff: 10 }) },
      { gracias: 'A2' },
    );
    expect(rows).toEqual([
      {
        key: 'gracias',
        mastery: 0.9,
        trialsEff: 10,
        stability: 0.6,
        isUntrained: false,
        claimedLevel: 'A2',
      },
    ]);
  });

  it('sorts ascending by mastery with untrained rows last, alphabetical within each group', () => {
    const rows = buildLifetimeMasteryRows(
      {
        zeta: score({ mastery: 0.9 }),
        alfa: score({ mastery: 0.3 }),
        beta: score({ mastery: 0.3 }),
      },
      { delta: 'B1', charlie: 'B1' },
    );
    expect(rows.map((r) => r.key)).toEqual(['alfa', 'beta', 'zeta', 'charlie', 'delta']);
  });
});

describe('buildLifetimeWordMasteryRows / buildLifetimeGrammarMasteryRows', () => {
  const snapshot: LearnerMasterySnapshot = {
    wordScores: { perro: score({ mastery: 0.4 }) },
    grammarItemScores: { 'preterite tense': score({ mastery: 0.8 }) },
    claimedWordLevels: { gato: 'A1' },
    claimedGrammarLevels: { 'subjunctive mood': 'B2' },
  };

  it('reads from wordScores / claimedWordLevels for words', () => {
    const rows = buildLifetimeWordMasteryRows(snapshot);
    expect(rows.map((r) => r.key)).toEqual(['perro', 'gato']);
  });

  it('reads from grammarItemScores / claimedGrammarLevels for grammar', () => {
    const rows = buildLifetimeGrammarMasteryRows(snapshot);
    expect(rows.map((r) => r.key)).toEqual(['preterite tense', 'subjunctive mood']);
  });
});
