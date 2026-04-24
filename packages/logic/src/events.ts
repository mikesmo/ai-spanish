import type { AccuracyBreakdown } from './accuracy';
import type { FluencyBreakdown } from './fluency';

/**
 * Events emitted by the UI that the mastery/SRS engines consume.
 *
 * Only `Attempt` events update mastery, stability, and cross-session SRS.
 * `PracticeAttempt` is the "Try Again" loop — purely motor/pronunciation
 * training, never touches progress state.
 * `RevealEvent` (tapping "Show Answer") is a strong failure signal that
 * decays both mastery and stability.
 */
export interface Attempt {
  eventType: 'attempt';
  phraseId: string;
  /** Words the user actually spoke, in order. */
  transcript: string[];
  /** Target words the user skipped. */
  missingWords: string[];
  /** Spoken words with no corresponding target word. */
  extraWords: string[];
  /** Weighted accuracy score, 0..1. */
  accuracyScore: number;
  /** Fluency score 0..1, or null if fluency could not be computed. */
  fluencyScore: number | null;
  /**
   * Canonical learning-success signal: `accuracyScore >= ACCURACY_SUCCESS_THRESHOLD`.
   * Feeds the stability EMA and mastery engine.
   */
  isAccuracySuccess: boolean;
  /**
   * UI-only exact-match signal: normalized(transcript) === normalized(target).
   * Drives the success chime and state-machine transition. The mastery/SRS
   * engines never read this.
   */
  success: boolean;
  timestamp: number;
  /** Full weighted accuracy from `computeAccuracy` at emit time. */
  accuracyBreakdown: AccuracyBreakdown;
  /** Fluency subscores, or null when `fluencyScore` is null. */
  fluencyBreakdown: FluencyBreakdown | null;
}

export interface PracticeAttempt {
  eventType: 'practice';
  phraseId: string;
  transcript: string[];
  fluencyScore: number | null;
  timestamp: number;
  accuracyBreakdown: AccuracyBreakdown;
  fluencyBreakdown: FluencyBreakdown | null;
}

export interface RevealEvent {
  eventType: 'reveal';
  phraseId: string;
  penaltyApplied: true;
  timestamp: number;
}

export type PhraseEvent = Attempt | PracticeAttempt | RevealEvent;
