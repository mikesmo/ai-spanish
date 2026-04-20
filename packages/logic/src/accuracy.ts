import type { AlignmentResult } from './alignment';
import type { WordMeta } from './types';

/**
 * Flat per-extra-word charge. Extras carry no intrinsic weight (they aren't in
 * the POS-tagged target vocabulary), so we charge a deterministic constant.
 */
export const EXTRA_WORD_PENALTY = 0.7;

/**
 * Ceiling on the aggregate extra penalty. Without a cap, a run of filler
 * words or an STT misfire can drive accuracy to 0 purely from noise. With
 * the cap, extras can subtract at most `EXTRA_PENALTY_CAP / totalWeight`
 * from accuracy.
 */
export const EXTRA_PENALTY_CAP = 1.0;

/**
 * Threshold above which an attempt counts as a "learning success" for the
 * stability EMA. Distinct from the UI's exact-match `isCorrect` bool.
 */
export const ACCURACY_SUCCESS_THRESHOLD = 0.85;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const sumWeights = (words: WordMeta[]): number =>
  words.reduce((acc, w) => acc + w.weight, 0);

export interface AccuracyBreakdown {
  accuracy: number;
  totalWeight: number;
  missingPenalty: number;
  extraPenalty: number;
  rawExtraPenalty: number;
}

/**
 * Weighted accuracy of an attempt. See docs/SpacedRepetitionSystemModel.md.
 *
 * - Missing words contribute their POS weight to the penalty.
 * - Extra words contribute a flat EXTRA_WORD_PENALTY each, capped in aggregate
 *   at EXTRA_PENALTY_CAP.
 * - The result is clamped to [0, 1].
 */
export function computeAccuracy(
  target: WordMeta[],
  alignment: AlignmentResult,
): AccuracyBreakdown {
  const totalWeight = sumWeights(target);
  const missingPenalty = sumWeights(alignment.missing);
  const rawExtraPenalty = EXTRA_WORD_PENALTY * alignment.extra.length;
  const extraPenalty = Math.min(EXTRA_PENALTY_CAP, rawExtraPenalty);

  if (totalWeight <= 0) {
    // Degenerate: no target weight means we can't produce a meaningful score.
    return {
      accuracy: 0,
      totalWeight,
      missingPenalty,
      extraPenalty,
      rawExtraPenalty,
    };
  }

  const accuracy = clamp01(
    1 - (missingPenalty + extraPenalty) / totalWeight,
  );

  return {
    accuracy,
    totalWeight,
    missingPenalty,
    extraPenalty,
    rawExtraPenalty,
  };
}

export function isAccuracySuccess(accuracy: number): boolean {
  return accuracy >= ACCURACY_SUCCESS_THRESHOLD;
}
