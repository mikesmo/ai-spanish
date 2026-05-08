/**
 * Per-item mastery scoring.
 *
 * Tracks a 0-1 mastery number for each grammar item and each Spanish word the
 * user has been tested on. Companion to phrase-level mastery in
 * `./mastery.ts`. See `./itemMastery.README.md` for full prose.
 *
 * Algorithm summary (per trial with outcome x in [0, 1]):
 *   trialsEff'      = gamma * trialsEff      + 1
 *   successSumEff'  = gamma * successSumEff  + x
 *   stability'      = clamp01((1 - alpha) * stability + alpha * x)
 *
 *   pHat        = (successSumEff' + alphaSmooth * 0.5) / (trialsEff' + alphaSmooth)
 *   confidence  = trialsEff' / (trialsEff' + k)
 *
 *   mastery = clamp01(W_p * pHat + W_s * stability' + W_c * confidence)
 *
 * Reveal events do NOT count as a trial; they multiplicatively decay
 * `stability` and recompute `mastery` so a Show-Answer signals weakness
 * without inflating the trial count.
 */

import { STABILITY_EMA_ALPHA, MASTERY_LEARNING_CEIL, MASTERY_STABILIZING_CEIL } from './mastery';

/**
 * Recency decay applied to `trialsEff` and `successSumEff` on every trial.
 * Smaller = faster forgetting. With gamma = 0.95 each trial's weight halves
 * after ~13 subsequent trials and `trialsEff` saturates at 1 / (1 - gamma) = 20.
 */
export const ITEM_DECAY_GAMMA = 0.95;

/** Laplace prior strength for the smoothed success rate `pHat`. */
export const ITEM_LAPLACE_ALPHA = 2;

/** Saturating denominator for the confidence/coverage term. */
export const ITEM_CONFIDENCE_K = 5;

/** Weight on the smoothed success rate (`pHat`). */
export const ITEM_W_P_HAT = 0.5;

/** Weight on the stability EMA. */
export const ITEM_W_STABILITY = 0.3;

/** Weight on the confidence/coverage term. */
export const ITEM_W_CONFIDENCE = 0.2;

/**
 * Multiplicative decay applied to `stability` when a phrase containing this
 * item gets a reveal event. Mirrors `REVEAL_STABILITY_DECAY` from `mastery.ts`.
 */
export const ITEM_REVEAL_STABILITY_DECAY = 0.7;

/** Per-item mastery state. JSON-serializable plain object (no Map / Set). */
export interface ItemScore {
  /** Decayed effective trial count. Starts at 0; saturates near 1/(1-gamma). */
  trialsEff: number;
  /** Decayed sum of x outcomes. */
  successSumEff: number;
  /** Stability EMA in [0, 1]. */
  stability: number;
  /** Computed mastery in [0, 1]. Cached so callers don't have to recompute. */
  mastery: number;
  /** Per-session event seq of the most recent update. */
  lastUpdatedAtEventSeq: number;
}

/** Display band, mirrors phrase-level bands in `./mastery.ts`. */
export type ItemMasteryBand = 'weak' | 'stabilizing' | 'mastered';

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Initial state: zero trials, zero stability, zero mastery. */
export function createInitialItemScore(): ItemScore {
  return {
    trialsEff: 0,
    successSumEff: 0,
    stability: 0,
    mastery: 0,
    lastUpdatedAtEventSeq: 0,
  };
}

/**
 * Recomputes `mastery` from the other fields. Pure helper so callers can
 * invoke it after manually mutating `stability` (e.g. on reveal decay) without
 * duplicating the formula.
 */
export function computeItemMastery(
  trialsEff: number,
  successSumEff: number,
  stability: number,
): number {
  const pHat =
    (successSumEff + ITEM_LAPLACE_ALPHA * 0.5) / (trialsEff + ITEM_LAPLACE_ALPHA);
  const confidence = trialsEff / (trialsEff + ITEM_CONFIDENCE_K);
  return clamp01(
    ITEM_W_P_HAT * pHat +
      ITEM_W_STABILITY * stability +
      ITEM_W_CONFIDENCE * confidence,
  );
}

/**
 * Apply one trial with outcome `x in [0, 1]` (typically 0 or 1) to an existing
 * score. Returns a new ItemScore — does not mutate.
 */
export function updateItemScore(
  prev: ItemScore,
  x: number,
  eventSeq: number,
): ItemScore {
  const trialsEff = ITEM_DECAY_GAMMA * prev.trialsEff + 1;
  const successSumEff = ITEM_DECAY_GAMMA * prev.successSumEff + x;
  const stability = clamp01(
    (1 - STABILITY_EMA_ALPHA) * prev.stability + STABILITY_EMA_ALPHA * x,
  );
  const mastery = computeItemMastery(trialsEff, successSumEff, stability);
  return {
    trialsEff,
    successSumEff,
    stability,
    mastery,
    lastUpdatedAtEventSeq: eventSeq,
  };
}

/**
 * Reveal-event decay: shrinks `stability` multiplicatively WITHOUT bumping
 * `trialsEff`. Mirrors phrase-level reveal handling in `./mastery.ts`.
 */
export function decayItemOnReveal(
  prev: ItemScore,
  eventSeq: number,
): ItemScore {
  const stability = clamp01(prev.stability * ITEM_REVEAL_STABILITY_DECAY);
  const mastery = computeItemMastery(prev.trialsEff, prev.successSumEff, stability);
  return {
    trialsEff: prev.trialsEff,
    successSumEff: prev.successSumEff,
    stability,
    mastery,
    lastUpdatedAtEventSeq: eventSeq,
  };
}

/** Classify a mastery number into a display band. Reuses phrase-level cutoffs. */
export function classifyItemMastery(mastery: number): ItemMasteryBand {
  if (mastery < MASTERY_LEARNING_CEIL) return 'weak';
  if (mastery < MASTERY_STABILIZING_CEIL) return 'stabilizing';
  return 'mastered';
}

/**
 * True when this score has never been updated by a real trial. The UI uses
 * this to decide whether to render "—" (no data yet) instead of a number.
 */
export function isUntrained(score: ItemScore): boolean {
  return score.trialsEff < 1;
}
