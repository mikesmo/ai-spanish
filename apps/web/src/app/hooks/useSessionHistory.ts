"use client";

import { useCallback, useRef, useState } from "react";
import {
  alignWords,
  computeAccuracy,
  computeMastery,
  getDefaultLearningPipelineDebug,
  isAccuracySuccess,
  logSessionHistoryAppend,
  reduceProgress,
  type Phrase,
  type PhraseEvent,
  type PhraseEventContext,
  type PhraseProgress,
  type SpokenWord,
} from "@ai-spanish/logic";

export interface ScoreSummary {
  accuracy: number;
  fluency: number | null;
  mastery: number;
  isAccuracySuccess: boolean;
}

export interface HistoryEntry {
  id: string;
  event: PhraseEvent;
  phrase: Phrase;
  scoreSummary: ScoreSummary | null;
  /**
   * True when this event was logged during a second-or-later presentation of
   * the same `phrase.id` in the current session (e.g. Pimsleur requeue or
   * linear deck wrap). Orthogonal to PracticeAttempt — a row can be both a
   * revisit AND a Try Again practice event on that revisit's card.
   */
  isRepeatedPresentation: boolean;
  /**
   * Epoch ms when this phrase is next due for SRS review after applying this
   * event — i.e. `reduceProgress(prev, event).nextReviewAt`. For `practice`
   * events (which never touch progress) this is the prior schedule carried
   * forward, matching `reduceProgress` semantics.
   */
  nextReviewAt: number;
  /**
   * Snapshot of the in-session queue position (0-based index into the
   * remaining queue) for this phrase **immediately after** the session engine
   * processed this event. `null` when the phrase is not in the queue — e.g.
   * a mastered attempt that dropped the card, or a practice event (which
   * never reorders). Populated from `useLessonSession` `PhraseEventContext`
   * (not a ref). Static after creation; pair with a live
   * `getLiveSlotsAhead` for “session (now)”.
   */
  slotsAheadAtEvent: number | null;
}

export interface UseSessionHistoryResult {
  history: HistoryEntry[];
  /**
   * Called from `useLessonSession` after the engine has applied the event.
   * `ctx` is required when wiring through the web lesson host.
   */
  onPhraseEvent: (event: PhraseEvent, ctx: PhraseEventContext) => void;
  /**
   * Call on each render with the currently displayed phrase. Events emitted
   * before the next call will be attributed to this phrase. Setting a ref
   * during render is safe in React — no state updates occur here.
   */
  bindCurrentPhrase: (phrase: Phrase | undefined) => void;
  /**
   * Stable callback — pass to usePhraseDisplay options. Invoked once per
   * new phrase card (not once per Try Again). Increments the per-phrase
   * visit counter so subsequent events during that card are flagged as
   * repeated presentations.
   */
  onPresentationStart: (phrase: Phrase) => void;
  clearHistory: () => void;
}

const generateId = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * In-memory log of every PhraseEvent emitted during the current session.
 *
 * For Attempt events we precompute a ScoreSummary — stability is pinned to
 * 0, matching the preview convention used by
 * usePhraseDisplay.lastScoreBreakdown.
 *
 * For PracticeAttempt events we also precompute a ScoreSummary as an
 * informational display. These values are NEVER fed into `reduceProgress`,
 * the mastery engine, or SRS — the spec rule "Try Again is motor/
 * pronunciation only" is enforced upstream by the session engine and
 * reducer. The history sidebar just reconstructs accuracy from the event's
 * transcript + target word meta so the user can see per-retry improvement.
 */
export const useSessionHistory = (): UseSessionHistoryResult => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const phraseRef = useRef<Phrase | undefined>(undefined);
  /**
   * Per-phrase presentation counter. Incremented in `onPresentationStart`
   * for each new card shown (not per Try Again). Events appended while
   * count > 1 are flagged as repeated presentations.
   */
  const visitCountsRef = useRef<Map<string, number>>(new Map());
  /** Whether the currently displayed card is a revisit of a previous one. */
  const currentIsRepeatRef = useRef(false);
  /**
   * Per-phrase SRS progress, mirroring what a `ProgressStore` would hold.
   * Updated via `reduceProgress` on each logged event so every HistoryEntry
   * can surface its post-event `nextReviewAt`.
   */
  const progressByPhraseRef = useRef<Map<string, PhraseProgress>>(new Map());

  const onPhraseEvent = useCallback(
    (event: PhraseEvent, ctx: PhraseEventContext): void => {
    const phrase = phraseRef.current;
    if (!phrase) return;

    let scoreSummary: ScoreSummary | null = null;
    if (event.eventType === "attempt") {
      scoreSummary = {
        accuracy: event.accuracyScore,
        fluency: event.fluencyScore,
        mastery: computeMastery(event.accuracyScore, event.fluencyScore, 0),
        isAccuracySuccess: event.isAccuracySuccess,
      };
    } else if (event.eventType === "practice") {
      // Practice events only carry transcript strings (no word timings).
      // computeAccuracy is pure word-identity + POS-weight math, so zero-timed
      // SpokenWord stubs produce the same score as fully timed input. Values
      // are informational only — the mastery engine ignores practice events.
      const target = phrase.Spanish.words;
      const spokenStub: SpokenWord[] = event.transcript.map((w) => ({
        word: w,
        start: 0,
        end: 0,
      }));
      const alignment = alignWords(target, spokenStub);
      const { accuracy } = computeAccuracy(target, alignment);
      scoreSummary = {
        accuracy,
        fluency: event.fluencyScore,
        mastery: computeMastery(accuracy, event.fluencyScore, 0),
        isAccuracySuccess: isAccuracySuccess(accuracy),
      };
    }

    const prevProgress = progressByPhraseRef.current.get(phrase.id) ?? null;
    const nextProgress = reduceProgress(prevProgress, event);
    progressByPhraseRef.current.set(phrase.id, nextProgress);

    const slotsAheadAtEvent = ctx.slotsAheadAtEvent;

    if (getDefaultLearningPipelineDebug()) {
      const transcriptStr =
        event.eventType === "reveal"
          ? ""
          : (event as { transcript: string[] }).transcript.join(" ");
      logSessionHistoryAppend({
        eventType: event.eventType,
        phraseId: phrase.id,
        transcriptPreview: transcriptStr,
        nextReviewAt: nextProgress.nextReviewAt,
        slotsSessionLog: ctx.slotsAheadAtEvent,
        slotsSessionNow: ctx.liveSlotsAhead,
      });
    }

    const entry: HistoryEntry = {
      id: generateId(),
      event,
      phrase,
      scoreSummary,
      isRepeatedPresentation: currentIsRepeatRef.current,
      nextReviewAt: nextProgress.nextReviewAt,
      slotsAheadAtEvent,
    };

    setHistory((prev) => [...prev, entry]);
  },
  [],
  );

  const bindCurrentPhrase = useCallback(
    (phrase: Phrase | undefined): void => {
      phraseRef.current = phrase;
    },
    [],
  );

  const onPresentationStart = useCallback((phrase: Phrase): void => {
    const prev = visitCountsRef.current.get(phrase.id) ?? 0;
    const next = prev + 1;
    visitCountsRef.current.set(phrase.id, next);
    currentIsRepeatRef.current = next > 1;
  }, []);

  const clearHistory = useCallback((): void => {
    visitCountsRef.current.clear();
    currentIsRepeatRef.current = false;
    progressByPhraseRef.current.clear();
    setHistory([]);
  }, []);

  return {
    history,
    onPhraseEvent,
    bindCurrentPhrase,
    onPresentationStart,
    clearHistory,
  };
};
