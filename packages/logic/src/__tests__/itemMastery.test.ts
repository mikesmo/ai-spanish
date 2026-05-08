import { describe, expect, it } from 'vitest';
import {
  ITEM_DECAY_GAMMA,
  ITEM_REVEAL_STABILITY_DECAY,
  classifyItemMastery,
  computeItemMastery,
  createInitialItemScore,
  decayItemOnReveal,
  isUntrained,
  updateItemScore,
} from '../itemMastery';

describe('itemMastery', () => {
  describe('createInitialItemScore', () => {
    it('returns the all-zero state and is untrained', () => {
      const score = createInitialItemScore();
      expect(score).toEqual({
        trialsEff: 0,
        successSumEff: 0,
        stability: 0,
        mastery: 0,
        lastUpdatedAtEventSeq: 0,
      });
      expect(isUntrained(score)).toBe(true);
    });
  });

  describe('updateItemScore', () => {
    it('first failure produces a low mastery and stamps the eventSeq', () => {
      const score = updateItemScore(createInitialItemScore(), 0, 7);
      expect(score.trialsEff).toBeCloseTo(1, 6);
      expect(score.successSumEff).toBeCloseTo(0, 6);
      expect(score.stability).toBeCloseTo(0, 6);
      expect(score.lastUpdatedAtEventSeq).toBe(7);
      // pHat = 1/3, C = 1/6, S = 0  ->  mastery = 0.5/3 + 0 + 0.2/6 = 0.2
      expect(score.mastery).toBeCloseTo(0.2, 4);
      expect(isUntrained(score)).toBe(false);
    });

    it('first success produces a higher mastery than a first failure', () => {
      const pass = updateItemScore(createInitialItemScore(), 1, 1);
      const fail = updateItemScore(createInitialItemScore(), 0, 1);
      expect(pass.mastery).toBeGreaterThan(fail.mastery);
    });

    it('matches the worked-example sequence [fail, fail, pass x 6]', () => {
      let s = createInitialItemScore();
      const xs = [0, 0, 1, 1, 1, 1, 1, 1];
      const masteries: number[] = [];
      let seq = 1;
      for (const x of xs) {
        s = updateItemScore(s, x, seq++);
        masteries.push(s.mastery);
      }
      // Mastery dips on the two failures then climbs monotonically with passes.
      expect(masteries[0]).toBeLessThan(0.25); // worse than initial
      expect(masteries[1]).toBeLessThan(masteries[0]); // second failure lower still
      for (let i = 3; i < masteries.length; i++) {
        expect(masteries[i]).toBeGreaterThan(masteries[i - 1]);
      }
      // After 6 passes following 2 failures, mastery is in the stabilizing band
      // but not yet mastered (still recovering).
      expect(masteries[masteries.length - 1]).toBeGreaterThan(0.5);
      expect(masteries[masteries.length - 1]).toBeLessThan(0.8);
    });

    it('stability EMA converges toward 1 with consecutive successes', () => {
      let s = createInitialItemScore();
      for (let i = 1; i <= 20; i++) s = updateItemScore(s, 1, i);
      expect(s.stability).toBeGreaterThan(0.99);
    });

    it('saturates trialsEff near 1 / (1 - gamma)', () => {
      const cap = 1 / (1 - ITEM_DECAY_GAMMA);
      let s = createInitialItemScore();
      for (let i = 1; i <= 200; i++) s = updateItemScore(s, 1, i);
      expect(s.trialsEff).toBeLessThan(cap + 0.001);
      expect(s.trialsEff).toBeGreaterThan(cap - 0.5);
    });
  });

  describe('decayItemOnReveal', () => {
    it('does not change trialsEff or successSumEff', () => {
      const before = updateItemScore(createInitialItemScore(), 1, 1);
      const after = decayItemOnReveal(before, 2);
      expect(after.trialsEff).toBe(before.trialsEff);
      expect(after.successSumEff).toBe(before.successSumEff);
      expect(after.lastUpdatedAtEventSeq).toBe(2);
    });

    it('shrinks stability multiplicatively and lowers mastery', () => {
      let s = createInitialItemScore();
      for (let i = 1; i <= 5; i++) s = updateItemScore(s, 1, i);
      const masteryBefore = s.mastery;
      const stabilityBefore = s.stability;
      const decayed = decayItemOnReveal(s, 6);
      expect(decayed.stability).toBeCloseTo(
        stabilityBefore * ITEM_REVEAL_STABILITY_DECAY,
        6,
      );
      expect(decayed.mastery).toBeLessThan(masteryBefore);
    });

    it('is a no-op on an all-zero stability (clamped to 0)', () => {
      const s = createInitialItemScore();
      const decayed = decayItemOnReveal(s, 9);
      expect(decayed.stability).toBe(0);
    });
  });

  describe('decay reduces the weight of older failures', () => {
    it('a failure 13 trials old contributes < 60% of its original weight', () => {
      // Apply one failure at trial 1, then 13 successes after it. The first
      // failure's contribution to trialsEff/successSumEff is gamma^13.
      let s = updateItemScore(createInitialItemScore(), 0, 1);
      for (let i = 0; i < 13; i++) s = updateItemScore(s, 1, 2 + i);
      const oldFailureWeight = ITEM_DECAY_GAMMA ** 13;
      expect(oldFailureWeight).toBeLessThan(0.6);
      expect(oldFailureWeight).toBeGreaterThan(0.4);
    });
  });

  describe('classifyItemMastery', () => {
    it('returns weak below 0.6', () => {
      expect(classifyItemMastery(0)).toBe('weak');
      expect(classifyItemMastery(0.59)).toBe('weak');
    });

    it('returns stabilizing in [0.6, 0.8)', () => {
      expect(classifyItemMastery(0.6)).toBe('stabilizing');
      expect(classifyItemMastery(0.79)).toBe('stabilizing');
    });

    it('returns mastered at or above 0.8', () => {
      expect(classifyItemMastery(0.8)).toBe('mastered');
      expect(classifyItemMastery(1)).toBe('mastered');
    });
  });

  describe('computeItemMastery', () => {
    it('matches the formula at zero state', () => {
      // pHat = 0.5, C = 0, S = 0  ->  0.5 * 0.5 = 0.25
      expect(computeItemMastery(0, 0, 0)).toBeCloseTo(0.25, 6);
    });
  });
});
