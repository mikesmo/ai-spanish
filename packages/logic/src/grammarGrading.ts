/**
 * Shared types for the async AI grammar grading pipeline.
 * Lives in packages/logic so both web and mobile can share them.
 * The actual AI call lives in apps/web/src/app/api/grammar-grading/route.ts.
 */

/** All data sent to the /api/grammar-grading endpoint per attempt. */
export interface GrammarGradingRequest {
  phraseId: string;
  eventSeq: number;
  englishText: string;
  expectedSpanish: string;
  /** Comma-split items from Spanish.grammar — the grammar rules being tested. */
  grammarItems: string[];
  /** Comma-split items from Spanish.newGrammar — context for the AI, not tracked. */
  newGrammarItems: string[];
  /** STT transcript words from the user's attempt. */
  userTranscript: string[];
  /** Target words the user did not say (from alignment). */
  missingWords: string[];
  /** Words the user said that had no matching target word. */
  extraWords: string[];
}

/** A single failed grammar item with an AI-generated per-item explanation. */
export interface FailedGrammarItem {
  /** The exact grammar rule string from GrammarGradingRequest.grammarItems. */
  item: string;
  /** One sentence explaining why this specific rule was violated. */
  rationale: string;
}

/** Structured JSON result returned by the grammar grading endpoint. */
export interface GrammarGradingResult {
  /**
   * Subset of GrammarGradingRequest.grammarItems that the AI determined the
   * user violated, each with an AI-generated rationale.
   * Empty when the mistake was purely word-choice driven.
   */
  failedGrammarItems: FailedGrammarItem[];
  /**
   * Words the AI determined were pure word-choice mistakes (not driven by a
   * grammar error). Used for display in the sidebar only; resolution logic
   * still uses alignment-based missingWords.
   */
  wordMistakes: string[];
}

/**
 * Lifecycle status of the async AI grading call for a single attempt event.
 * - 'pending': request in-flight, classification not yet known.
 * - 'success': AI returned a valid classification.
 * - 'failed': request timed out or errored; alignment-based fallback was used.
 * - 'n/a': not applicable — practice or reveal events are never AI-graded.
 */
export type GrammarGradingStatus = 'pending' | 'success' | 'failed' | 'n/a';

/** Metadata stored per-event in useLessonSession for deferred applyGradingResult calls. */
export interface PendingGradingEventInfo {
  phraseId: string;
  grammarItems: string[];
  missingWords: string[];
  isAccuracySuccess: boolean;
  canResolve: boolean;
  startedAtMs: number;
}
