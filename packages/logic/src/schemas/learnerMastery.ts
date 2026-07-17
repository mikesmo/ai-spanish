import { z } from 'zod';
import { itemScoreSchema } from './incorrectPhraseRecord';
import { cefrLevelSchema } from './cefrLevel';

/**
 * Response shape for `GET /api/learner-mastery` — the authenticated user's
 * lifetime per-word / per-grammar-item mastery snapshot.
 *
 * `wordScores` / `grammarItemScores` feed session seeding (see
 * `useLessonSession`'s `initialItemScores`) and are agnostic to provenance.
 * `claimedWordLevels` / `claimedGrammarLevels` are for reporting UI (future
 * work) to distinguish "should know per your declared level" from "proven
 * through practice" — keyed the same way, values omitted for keys that were
 * never part of a CEFR level claim.
 */
export const learnerMasterySnapshotSchema = z.object({
  wordScores: z.record(z.string(), itemScoreSchema).default({}),
  grammarItemScores: z.record(z.string(), itemScoreSchema).default({}),
  claimedWordLevels: z.record(z.string(), cefrLevelSchema).default({}),
  claimedGrammarLevels: z.record(z.string(), cefrLevelSchema).default({}),
});

export type LearnerMasterySnapshot = z.infer<typeof learnerMasterySnapshotSchema>;

/** Response shape for `GET` / `POST /api/learner-level`. */
export const declaredLevelResponseSchema = z.object({
  declaredLevel: cefrLevelSchema.nullable(),
});

export type DeclaredLevelResponse = z.infer<typeof declaredLevelResponseSchema>;
