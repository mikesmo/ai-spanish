import { describe, expect, it } from 'vitest';
import { computeFluency } from '../fluency';
import type { SpokenWord } from '../types';

const sw = (word: string, start: number, end: number): SpokenWord => ({
  word,
  start,
  end,
});

describe('computeFluency', () => {
  it('returns null for fewer than 2 words', () => {
    expect(computeFluency([])).toBeNull();
    expect(computeFluency([sw('hola', 0, 0.3)])).toBeNull();
  });

  it('returns null when timestamps are missing/non-finite', () => {
    const spoken: SpokenWord[] = [
      sw('hola', 0, 0.3),
      { word: 'mundo', start: Number.NaN, end: Number.NaN },
    ];
    expect(computeFluency(spoken)).toBeNull();
  });

  it('returns null when elapsed time is zero or negative', () => {
    const spoken: SpokenWord[] = [sw('a', 1, 1), sw('b', 1, 1)];
    expect(computeFluency(spoken)).toBeNull();
  });

  it('gives a high score for fast, evenly-paced speech in the target range', () => {
    // 5 words over ~1.65s ≈ 3 wps, tight gaps
    const spoken: SpokenWord[] = [
      sw('tengo', 0.0, 0.3),
      sw('que', 0.35, 0.45),
      sw('ir', 0.5, 0.7),
      sw('al', 0.75, 0.85),
      sw('banco', 0.9, 1.65),
    ];
    const result = computeFluency(spoken)!;
    expect(result).not.toBeNull();
    expect(result.speedScore).toBe(1);
    expect(result.pauseScore).toBe(1);
    expect(result.gapConsistencyScore).toBeGreaterThan(0.95);
    expect(result.fluencyScore).toBeGreaterThan(0.95);
    expect(result.longPauses).toBe(0);
  });

  it('penalizes long pauses via pauseScore', () => {
    // 3 words over ~3s with one 1s gap
    const spoken: SpokenWord[] = [
      sw('hola', 0, 0.3),
      sw('como', 1.5, 1.8), // 1.2s pause
      sw('estas', 2.0, 2.4),
    ];
    const result = computeFluency(spoken)!;
    expect(result.longPauses).toBeGreaterThanOrEqual(1);
    expect(result.pauseScore).toBeLessThan(1);
  });

  it('penalizes erratic pacing via gapConsistencyScore', () => {
    const uniform: SpokenWord[] = [
      sw('a', 0, 0.2),
      sw('b', 0.3, 0.5),
      sw('c', 0.6, 0.8),
      sw('d', 0.9, 1.1),
    ];
    const erratic: SpokenWord[] = [
      sw('a', 0, 0.2),
      sw('b', 0.25, 0.45),
      sw('c', 0.46, 0.66),
      sw('d', 1.3, 1.5),
    ];

    const uniformScore = computeFluency(uniform)!;
    const erraticScore = computeFluency(erratic)!;
    expect(erraticScore.gapConsistencyScore).toBeLessThan(
      uniformScore.gapConsistencyScore,
    );
  });

  it('penalizes speech that is too slow', () => {
    // 2 words over 10s → 0.2 wps, below the floor
    const spoken: SpokenWord[] = [sw('hola', 0, 0.3), sw('mundo', 9.5, 10)];
    const result = computeFluency(spoken)!;
    expect(result.speedScore).toBe(0);
    // Slow speech with a single long pause still degrades fluency vs.
    // a well-paced utterance in the target wps range.
    expect(result.fluencyScore).toBeLessThan(0.6);
  });

  it('fluencyScore is bounded in [0, 1]', () => {
    const spoken: SpokenWord[] = [sw('a', 0, 0.1), sw('b', 0.2, 0.3)];
    const result = computeFluency(spoken)!;
    expect(result.fluencyScore).toBeGreaterThanOrEqual(0);
    expect(result.fluencyScore).toBeLessThanOrEqual(1);
  });
});
