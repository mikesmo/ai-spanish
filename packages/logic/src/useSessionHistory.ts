'use client';

import { useCallback, useRef, useState } from 'react';
import { isAccuracySuccess } from './accuracy';
import {
  getDefaultLearningPipelineDebug,
  logSessionHistoryAppend,
} from './learningPipelineDebug';
import { reduceProgress, type ReduceProgressContext } from './mastery';
import type { PhraseEvent } from './events';
import type { Phrase, PhraseProgress } from './types';
import type { PhraseEventContext } from './useLessonSession';

export interface ScoreSummary {
  accuracy: number;
  fluency: number | null;
  /** Post-event mastery from `reduceProgress` (matches the engine). */
  mastery: number;
  isAccuracySuccess: boolean;
}

/** Per-row stability transition after applying the event in `reduceProgress`. */
export interface StabilityBreakdownSnapshot {
  before: number;
  after: number;
  kind: 'attempt_ema' | 'reveal_decay' | 'practice_unchanged';
  emaInput?: 0 | 1;
}

export interface HistoryEntry {
  id: string;
  event: PhraseEvent;
  phrase: Phrase;
  scoreSummary: ScoreSummary | null;
  stabilityBreakdown: StabilityBreakdownSnapshot;
  /** Mastery immediately before / after this event (reducer output). */
  masteryBefore: number;
  masteryAfter: number;
  /**
   * True when this event was logged during a second-or-later presentation of
   * the same `phrase.id` in the current session (e.g. Pimsleur requeue or
   * linear deck wrap). Orthogonal to PracticeAttempt — a row can be both a
   * revisit AND a Try Again practice event on that revisit's card.
   */
  isRepeatedPresentation: boolean;
  /**
   * Lesson index when this phrase becomes SRS-eligible after this event —
   * `reduceProgress(prev, event, ctx).dueOnLessonSessionIndex`. For `practice`
   * events (no progress change) this is the prior value carried forward.
   */
  dueOnLessonSessionIndex: number;
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
   * `ctx` is required when wiring through a lesson host.
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
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * In-memory log of every PhraseEvent emitted during the current session.
 *
 * Attempt and practice rows include a ScoreSummary: accuracy and fluency from
 * the emitted event; `mastery` is the post-event value from `reduceProgress`
 * (engine truth). Practice attempts do not change stored progress — mastery
 * before and after match — but accuracy/fluency still reflect the retry for
 * display. Each entry carries `stabilityBreakdown` and mastery before/after
 * for the sidebar or other consumers.
 *
 * @param completedLessonCount Lessons fully completed before this lesson run;
 *   must match the value passed into `useLessonSession` / the session engine.
 */
export const useSessionHistory = (
  completedLessonCount: number,
): UseSessionHistoryResult => {
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
   * Updated via `reduceProgress(..., ctx)` on each logged event so every
   * HistoryEntry can surface its post-event `dueOnLessonSessionIndex`.
   */
  const progressByPhraseRef = useRef<Map<string, PhraseProgress>>(new Map());

  const completedLessonCountRef = useRef(completedLessonCount);
  completedLessonCountRef.current = completedLessonCount;

  const onPhraseEvent = useCallback(
    (event: PhraseEvent, ctx: PhraseEventContext): void => {
      const phrase = phraseRef.current;
      if (!phrase) return;

      const reduceCtx: ReduceProgressContext = {
        completedLessonCount: completedLessonCountRef.current,
      };
      const prevProgress = progressByPhraseRef.current.get(phrase.id) ?? null;
      const nextProgress = reduceProgress(prevProgress, event, reduceCtx);
      progressByPhraseRef.current.set(phrase.id, nextProgress);

      const stabilityBefore = prevProgress?.stabilityScore ?? 0;
      const masteryBefore = prevProgress?.masteryScore ?? 0;
      const masteryAfter = nextProgress.masteryScore;

      let stabilityBreakdown: StabilityBreakdownSnapshot;
      if (event.eventType === 'attempt') {
        stabilityBreakdown = {
          kind: 'attempt_ema',
          before: stabilityBefore,
          after: nextProgress.stabilityScore,
          emaInput: event.isAccuracySuccess ? 1 : 0,
        };
      } else if (event.eventType === 'reveal') {
        stabilityBreakdown = {
          kind: 'reveal_decay',
          before: stabilityBefore,
          after: nextProgress.stabilityScore,
        };
      } else {
        stabilityBreakdown = {
          kind: 'practice_unchanged',
          before: stabilityBefore,
          after: nextProgress.stabilityScore,
        };
      }

      let scoreSummary: ScoreSummary | null = null;
      if (event.eventType === 'attempt') {
        scoreSummary = {
          accuracy: event.accuracyScore,
          fluency: event.fluencyScore,
          mastery: masteryAfter,
          isAccuracySuccess: event.isAccuracySuccess,
        };
      } else if (event.eventType === 'practice') {
        const acc = event.accuracyBreakdown.accuracy;
        scoreSummary = {
          accuracy: acc,
          fluency: event.fluencyScore,
          mastery: masteryAfter,
          isAccuracySuccess: isAccuracySuccess(acc),
        };
      }

      const slotsAheadAtEvent = ctx.slotsAheadAtEvent;

      if (getDefaultLearningPipelineDebug()) {
        const transcriptStr =
          event.eventType === 'reveal'
            ? ''
            : (event as { transcript: string[] }).transcript.join(' ');
        logSessionHistoryAppend({
          eventType: event.eventType,
          phraseId: phrase.id,
          transcriptPreview: transcriptStr,
          dueOnLessonSessionIndex: nextProgress.dueOnLessonSessionIndex,
          slotsSessionLog: ctx.slotsAheadAtEvent,
          slotsSessionNow: ctx.liveSlotsAhead,
        });
      }

      const entry: HistoryEntry = {
        id: generateId(),
        event,
        phrase,
        scoreSummary,
        stabilityBreakdown,
        masteryBefore,
        masteryAfter,
        isRepeatedPresentation: currentIsRepeatRef.current,
        dueOnLessonSessionIndex: nextProgress.dueOnLessonSessionIndex,
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
