import { describe, expect, it } from 'vitest';
import { alignWords } from '../alignment';
import {
  ACCURACY_SUCCESS_THRESHOLD,
  EXTRA_PENALTY_CAP,
  EXTRA_WORD_PENALTY,
  computeAccuracy,
  isAccuracySuccess,
} from '../accuracy';
import { POS_WEIGHTS } from '../weights';
import type { SpokenWord, WordMeta } from '../types';

const wm = (word: string, type: keyof typeof POS_WEIGHTS): WordMeta => ({
  word,
  type,
  weight: POS_WEIGHTS[type],
});

const sw = (word: string, start = 0, end = 0.1): SpokenWord => ({
  word,
  start,
  end,
});

// Target: "Tengo que ir al banco" — totalWeight = 3 + 1 + 3 + 0.5 + 2.5 = 10
const target: WordMeta[] = [
  wm('tengo', 'verb'),
  wm('que', 'conjunction'),
  wm('ir', 'verb'),
  wm('al', 'article'),
  wm('banco', 'noun'),
];

describe('computeAccuracy', () => {
  it('returns 1.0 for a perfect match', () => {
    const spoken = target.map((w, i) => sw(w.word, i * 0.2, i * 0.2 + 0.15));
    const result = computeAccuracy(target, alignWords(target, spoken));
    expect(result.accuracy).toBe(1);
    expect(result.totalWeight).toBe(10);
    expect(result.missingPenalty).toBe(0);
    expect(result.extraPenalty).toBe(0);
  });

  it('applies POS-weighted missing penalty', () => {
    // Miss "que" (1.0) + "al" (0.5) → penalty 1.5 → accuracy 1 - 1.5/10 = 0.85
    const spoken: SpokenWord[] = [sw('tengo'), sw('ir'), sw('banco')];
    const result = computeAccuracy(target, alignWords(target, spoken));
    expect(result.missingPenalty).toBe(1.5);
    expect(result.extraPenalty).toBe(0);
    expect(result.accuracy).toBeCloseTo(0.85);
  });

  it('charges EXTRA_WORD_PENALTY flat per extra', () => {
    // 1 extra → 0.7 penalty → 1 - 0.7/10 = 0.93
    const spoken: SpokenWord[] = [
      sw('tengo'),
      sw('que'),
      sw('umm'),
      sw('ir'),
      sw('al'),
      sw('banco'),
    ];
    const result = computeAccuracy(target, alignWords(target, spoken));
    expect(result.rawExtraPenalty).toBeCloseTo(EXTRA_WORD_PENALTY);
    expect(result.extraPenalty).toBeCloseTo(EXTRA_WORD_PENALTY);
    expect(result.accuracy).toBeCloseTo(0.93);
  });

  it('caps the aggregate extra penalty at EXTRA_PENALTY_CAP', () => {
    // 10 extras → raw 7.0, capped 1.0 → accuracy 1 - 1.0/10 = 0.9
    const spoken: SpokenWord[] = [
      ...target.map((w) => sw(w.word)),
      ...Array.from({ length: 10 }, (_, i) => sw(`x${i}`)),
    ];
    const result = computeAccuracy(target, alignWords(target, spoken));
    expect(result.rawExtraPenalty).toBeCloseTo(7);
    expect(result.extraPenalty).toBe(EXTRA_PENALTY_CAP);
    expect(result.accuracy).toBeCloseTo(0.9);
  });

  it('clamps to 0 when penalties exceed total weight', () => {
    // Miss everything (10) + 4 extras capped at 1 → 11/10 = clamped to 0
    const spoken: SpokenWord[] = [
      sw('uno'),
      sw('dos'),
      sw('tres'),
      sw('cuatro'),
    ];
    const result = computeAccuracy(target, alignWords(target, spoken));
    expect(result.accuracy).toBe(0);
  });

  it('returns 0 accuracy for a degenerate target', () => {
    const result = computeAccuracy([], alignWords([], []));
    expect(result.accuracy).toBe(0);
    expect(result.totalWeight).toBe(0);
  });

  it('isAccuracySuccess reflects the 0.85 threshold', () => {
    expect(isAccuracySuccess(ACCURACY_SUCCESS_THRESHOLD)).toBe(true);
    expect(isAccuracySuccess(ACCURACY_SUCCESS_THRESHOLD - 0.0001)).toBe(false);
    expect(isAccuracySuccess(1)).toBe(true);
    expect(isAccuracySuccess(0)).toBe(false);
  });
});
