import type { SpokenWord } from './types';

/** Target words-per-second for native-ish Spanish conversational speech. */
export const FLUENCY_TARGET_WPS_LOW = 2.0;
export const FLUENCY_TARGET_WPS_HIGH = 4.0;
export const FLUENCY_WPS_FLOOR = 0.5;
export const FLUENCY_WPS_CEIL = 6.0;

/** Gap length (seconds) that counts as a "long pause". */
export const FLUENCY_LONG_PAUSE_SEC = 0.5;
/** Each long pause subtracts this much from the pauseScore. */
export const FLUENCY_PAUSE_DECAY = 0.25;

/** Weights for the final fluencyScore. Must sum to 1. */
export const FLUENCY_SPEED_WEIGHT = 0.4;
export const FLUENCY_PAUSE_WEIGHT = 0.3;
export const FLUENCY_GAP_WEIGHT = 0.3;

export interface FluencyBreakdown {
  speedScore: number;
  pauseScore: number;
  gapConsistencyScore: number;
  fluencyScore: number;
  wordsPerSecond: number;
  longPauses: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Triangular falloff: 1.0 inside [low, high], 0.0 outside [floor, ceil], linear
 * interpolation in between.
 */
function triangularScore(
  value: number,
  floor: number,
  low: number,
  high: number,
  ceil: number,
): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= floor || value >= ceil) return 0;
  if (value >= low && value <= high) return 1;
  if (value < low) return (value - floor) / (low - floor);
  return (ceil - value) / (ceil - high);
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqDiffs = values.map((v) => (v - mean) ** 2);
  return sqDiffs.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Fluency from word-level timings. Returns `null` when fluency cannot be
 * meaningfully computed (fewer than 2 words, or missing timestamps). Callers
 * (the mastery reducer) treat a `null` as "use the no-fluency mastery formula".
 */
export function computeFluency(spoken: SpokenWord[]): FluencyBreakdown | null {
  if (!Array.isArray(spoken) || spoken.length < 2) return null;

  for (const w of spoken) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) return null;
  }

  const first = spoken[0]!;
  const last = spoken[spoken.length - 1]!;
  const elapsed = last.end - first.start;
  if (elapsed <= 0) return null;

  const wordsPerSecond = spoken.length / elapsed;
  const speedScore = triangularScore(
    wordsPerSecond,
    FLUENCY_WPS_FLOOR,
    FLUENCY_TARGET_WPS_LOW,
    FLUENCY_TARGET_WPS_HIGH,
    FLUENCY_WPS_CEIL,
  );

  const gaps: number[] = [];
  let longPauses = 0;
  for (let i = 1; i < spoken.length; i++) {
    const gap = spoken[i]!.start - spoken[i - 1]!.end;
    const normalized = gap < 0 ? 0 : gap;
    gaps.push(normalized);
    if (normalized > FLUENCY_LONG_PAUSE_SEC) longPauses++;
  }

  const pauseScore = clamp01(1 - FLUENCY_PAUSE_DECAY * longPauses);
  const gapVariance = variance(gaps);
  const gapConsistencyScore = 1 / (1 + gapVariance);

  const fluencyScore = clamp01(
    FLUENCY_SPEED_WEIGHT * speedScore +
      FLUENCY_PAUSE_WEIGHT * pauseScore +
      FLUENCY_GAP_WEIGHT * gapConsistencyScore,
  );

  return {
    speedScore,
    pauseScore,
    gapConsistencyScore,
    fluencyScore,
    wordsPerSecond,
    longPauses,
  };
}
