/**
 * Lifetime word/grammar mastery report rows, built from a
 * `LearnerMasterySnapshot` (`GET /api/learner-mastery`) rather than a single
 * lesson's `HistoryEntry[]`.
 *
 * The lesson-scoped builders in `./lessonReport.ts`
 * (`buildWordsByMastery` / `buildGrammarItemsByMastery`) require history
 * entries to derive part-of-speech and phrase associations — data that does
 * not exist at the lifetime-snapshot layer. These builders instead work
 * directly off the `wordScores` / `grammarItemScores` + `claimedWordLevels` /
 * `claimedGrammarLevels` maps.
 *
 * Note: word keys are the `normalizeStr`-normalized *lemma* (dictionary
 * form), not the literal surface word a learner said/wrote — see
 * `incorrectPhraseTracker.ts` — so rows display that normalized lemma; no
 * original casing/display form or encountered surface forms are persisted at
 * this lifetime layer (unlike the lesson-scoped `WordMasteryRow`, which has
 * `displayWord`/`surfaceForms` derived from that lesson's history).
 */

import type { ItemScore } from './itemMastery';
import { isUntrained } from './itemMastery';
import type { CefrLevel } from './schemas/cefrLevel';
import type { LearnerMasterySnapshot } from './schemas/learnerMastery';

export interface LifetimeMasteryRow {
  /** Normalized word *lemma* (dictionary form), or the raw grammar item token. */
  key: string;
  mastery: number;
  trialsEff: number;
  stability: number;
  /** True when this key has never been updated by a real trial. */
  isUntrained: boolean;
  /**
   * CEFR level this item was claimed at via the learner's declared level
   * (seeded zero-score row), when applicable. Present regardless of whether
   * the item has since been practiced.
   */
  claimedLevel?: CefrLevel;
}

/**
 * Merges a score map with a claimed-level map into sorted report rows.
 * A key can be:
 *  - practiced only (in `scores`, not in `claimedLevels`)
 *  - claimed only (in `claimedLevels`, not in `scores` — zero-score seed row)
 *  - both (claimed, and since practiced)
 *
 * Sorted ascending by mastery (lowest first); untrained rows sorted last,
 * alphabetically among themselves. Mirrors the sort convention of
 * `buildWordsByMastery` / `buildGrammarItemsByMastery` in `./lessonReport.ts`.
 */
export function buildLifetimeMasteryRows(
  scores: Record<string, ItemScore>,
  claimedLevels: Record<string, CefrLevel>,
): LifetimeMasteryRow[] {
  const keys = new Set<string>([
    ...Object.keys(scores),
    ...Object.keys(claimedLevels),
  ]);

  const rows: LifetimeMasteryRow[] = [];
  for (const key of keys) {
    const score = scores[key];
    rows.push({
      key,
      mastery: score?.mastery ?? 0,
      trialsEff: score?.trialsEff ?? 0,
      stability: score?.stability ?? 0,
      isUntrained: score ? isUntrained(score) : true,
      claimedLevel: claimedLevels[key],
    });
  }

  rows.sort((a, b) => {
    if (a.isUntrained !== b.isUntrained) return a.isUntrained ? 1 : -1;
    if (a.mastery !== b.mastery) return a.mastery - b.mastery;
    return a.key.localeCompare(b.key);
  });

  return rows;
}

/**
 * Builds lifetime word-mastery report rows from a learner mastery snapshot.
 * Rows are keyed by normalized lemma, not literal surface form.
 */
export function buildLifetimeWordMasteryRows(
  snapshot: LearnerMasterySnapshot,
): LifetimeMasteryRow[] {
  return buildLifetimeMasteryRows(snapshot.wordScores, snapshot.claimedWordLevels);
}

/** Builds lifetime grammar-item mastery report rows from a learner mastery snapshot. */
export function buildLifetimeGrammarMasteryRows(
  snapshot: LearnerMasterySnapshot,
): LifetimeMasteryRow[] {
  return buildLifetimeMasteryRows(
    snapshot.grammarItemScores,
    snapshot.claimedGrammarLevels,
  );
}
