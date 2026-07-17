import type { ItemScore } from './itemMastery';
import { createInitialItemScore } from './itemMastery';
import type { CefrLevel } from './schemas/cefrLevel';
import type { LearnerMasterySnapshot } from './schemas/learnerMastery';

/** `user_word_mastery` row shape (snake_case to match the Supabase column names). */
export interface UserWordMasteryRow {
  user_id: string;
  word: string;
  trials_eff: number;
  success_sum_eff: number;
  stability: number;
  mastery: number;
  updated_at: string;
}

/** `user_grammar_mastery` row shape. */
export interface UserGrammarMasteryRow {
  user_id: string;
  grammar_item: string;
  trials_eff: number;
  success_sum_eff: number;
  stability: number;
  mastery: number;
  updated_at: string;
}

/** Minimal row shape read back from `user_word_mastery` for GET / seed-backfill lookups. */
export interface UserWordMasterySelectRow {
  word: string;
  trials_eff: number;
  success_sum_eff: number;
  stability: number;
  mastery: number;
  claimed_at_level: string | null;
}

/** Minimal row shape read back from `user_grammar_mastery`. */
export interface UserGrammarMasterySelectRow {
  grammar_item: string;
  trials_eff: number;
  success_sum_eff: number;
  stability: number;
  mastery: number;
  claimed_at_level: string | null;
}

/**
 * Builds `user_word_mastery` upsert rows from a session's final `wordScores`
 * map (from the completion checkpoint). Deliberately omits `claimed_at_level`
 * so upserting from practice never clobbers an existing CEFR-level claim tag
 * (Postgres `ON CONFLICT DO UPDATE` only touches columns present in the row).
 */
export function buildWordMasteryRows(
  userId: string,
  wordScores: Record<string, ItemScore>,
  updatedAtIso: string = new Date().toISOString(),
): UserWordMasteryRow[] {
  return Object.entries(wordScores).map(([word, score]) => ({
    user_id: userId,
    word,
    trials_eff: score.trialsEff,
    success_sum_eff: score.successSumEff,
    stability: score.stability,
    mastery: score.mastery,
    updated_at: updatedAtIso,
  }));
}

/** Builds `user_grammar_mastery` upsert rows from a session's final `grammarItemScores` map. */
export function buildGrammarMasteryRows(
  userId: string,
  grammarItemScores: Record<string, ItemScore>,
  updatedAtIso: string = new Date().toISOString(),
): UserGrammarMasteryRow[] {
  return Object.entries(grammarItemScores).map(([grammarItem, score]) => ({
    user_id: userId,
    grammar_item: grammarItem,
    trials_eff: score.trialsEff,
    success_sum_eff: score.successSumEff,
    stability: score.stability,
    mastery: score.mastery,
    updated_at: updatedAtIso,
  }));
}

/**
 * Converts persisted DB rows back into the `{ wordScores, grammarItemScores,
 * claimedWordLevels, claimedGrammarLevels }` shape served by
 * `GET /api/learner-mastery`. `lastUpdatedAtEventSeq` is not persisted (it's a
 * per-session sequence number with no cross-session meaning) — seeded scores
 * always get `lastUpdatedAtEventSeq: 0`, which is lower than any real
 * in-session event seq, so seed values are correctly superseded once a real
 * trial occurs.
 */
export function parseLearnerMasterySnapshot(
  wordRows: readonly UserWordMasterySelectRow[],
  grammarRows: readonly UserGrammarMasterySelectRow[],
): LearnerMasterySnapshot {
  const wordScores: Record<string, ItemScore> = {};
  const claimedWordLevels: Record<string, CefrLevel> = {};
  for (const row of wordRows) {
    wordScores[row.word] = {
      trialsEff: row.trials_eff,
      successSumEff: row.success_sum_eff,
      stability: row.stability,
      mastery: row.mastery,
      lastUpdatedAtEventSeq: 0,
    };
    if (row.claimed_at_level) {
      claimedWordLevels[row.word] = row.claimed_at_level as CefrLevel;
    }
  }

  const grammarItemScores: Record<string, ItemScore> = {};
  const claimedGrammarLevels: Record<string, CefrLevel> = {};
  for (const row of grammarRows) {
    grammarItemScores[row.grammar_item] = {
      trialsEff: row.trials_eff,
      successSumEff: row.success_sum_eff,
      stability: row.stability,
      mastery: row.mastery,
      lastUpdatedAtEventSeq: 0,
    };
    if (row.claimed_at_level) {
      claimedGrammarLevels[row.grammar_item] = row.claimed_at_level as CefrLevel;
    }
  }

  return { wordScores, grammarItemScores, claimedWordLevels, claimedGrammarLevels };
}

/**
 * Builds zero-score `user_word_mastery` seed rows for a declared CEFR level.
 * Callers must upsert with `ignoreDuplicates: true` (`ON CONFLICT DO NOTHING`)
 * so a word the learner has already practiced is never reset to zero.
 */
export function buildClaimedWordSeedRows(
  userId: string,
  words: readonly string[],
  level: CefrLevel,
  updatedAtIso: string = new Date().toISOString(),
): (UserWordMasteryRow & { claimed_at_level: CefrLevel })[] {
  const zero = createInitialItemScore();
  return words.map((word) => ({
    user_id: userId,
    word,
    trials_eff: zero.trialsEff,
    success_sum_eff: zero.successSumEff,
    stability: zero.stability,
    mastery: zero.mastery,
    claimed_at_level: level,
    updated_at: updatedAtIso,
  }));
}

/** Builds zero-score `user_grammar_mastery` seed rows for a declared CEFR level. See `buildClaimedWordSeedRows`. */
export function buildClaimedGrammarSeedRows(
  userId: string,
  grammarItems: readonly string[],
  level: CefrLevel,
  updatedAtIso: string = new Date().toISOString(),
): (UserGrammarMasteryRow & { claimed_at_level: CefrLevel })[] {
  const zero = createInitialItemScore();
  return grammarItems.map((grammarItem) => ({
    user_id: userId,
    grammar_item: grammarItem,
    trials_eff: zero.trialsEff,
    success_sum_eff: zero.successSumEff,
    stability: zero.stability,
    mastery: zero.mastery,
    claimed_at_level: level,
    updated_at: updatedAtIso,
  }));
}
