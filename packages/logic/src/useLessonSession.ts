'use client';

import { useCallback, useRef, useState } from 'react';
import {
  getDefaultLearningPipelineDebug,
  logSessionEnginePhraseMismatch,
} from './learningPipelineDebug';
import { createSessionEngine, type SessionEngine } from './sessionEngine';
import { createInMemoryProgressStore } from './progressStore';
import type { Phrase } from './types';
import type { PhraseEvent } from './events';

/**
 * Emitted with `onEvent` after `engine.onEvent` so consumers do not rely on a
 * separately bound `getQueuePosition` ref (race with first event / ordering).
 */
export interface PhraseEventContext {
  /**
   * `engine.getQueuePosition(event.phraseId)` right after the engine applied
   * the event. `null` when the phrase is not in the remaining queue.
   */
  slotsAheadAtEvent: number | null;
  /**
   * Second read of `getQueuePosition` in the same turn; should match
   * `slotsAheadAtEvent` (sidebar "session (now)" uses the same lookup later).
   */
  liveSlotsAhead: number | null;
}

export interface UseLessonSessionOptions {
  /**
   * Optional side-channel invoked on every PhraseEvent *after* the engine has
   * processed it. Receives the same `getQueuePosition` snapshot the session
   * history needs so it is never `null` due to a stale ref callback.
   */
  onEvent?: (event: PhraseEvent, ctx: PhraseEventContext) => void;
  /**
   * Optional stable callback forwarded directly from the host. If provided,
   * the core hook re-exports it as `onPresentationStart` so
   * `usePhraseDisplay` consumers can wire it without the host having to
   * destructure separately. Not used by the engine itself.
   */
  onPresentationStart?: (phrase: Phrase) => void;
  /**
   * Lessons fully completed *before* this lesson run. Drives session-based SRS
   * in the progress store. Default 0. Host should bump between runs and persist.
   */
  completedLessonCount?: number;
}

export interface UseLessonSessionResult {
  /**
   * The phrase currently on screen. Stays on the last-drawn phrase after
   * the queue drains (paired with `isComplete`) so `usePhraseDisplay` never
   * sees an empty array.
   */
  currentPhrase: Phrase;
  /**
   * One-element array for `usePhraseDisplay`. Using a 1-element array +
   * `presentationVersion` lets the in-logic phrase-bootstrap effect re-fire
   * on requeued phrases without rebuilding the hook.
   */
  phrases: [Phrase];
  /**
   * Monotonic counter bumped on every `advance()`. Passed to
   * `usePhraseDisplay` as `presentationVersion` so a requeued phrase at the
   * same index (or a 1-element `phrases` array) still triggers a fresh
   * bootstrap.
   */
  presentationVersion: number;
  /** Wire to `usePhraseDisplay.onPhraseEvent`. */
  onPhraseEvent: (event: PhraseEvent) => void;
  /**
   * Forwarded from `options.onPresentationStart`. Undefined when the host
   * does not provide one — the mobile app currently does not need session
   * history so this is commonly undefined there.
   */
  onPresentationStart: ((phrase: Phrase) => void) | undefined;
  /** Draws the next phrase from the engine queue. No-op when complete. */
  advance: () => void;
  /** Phrases remaining in the queue (excludes the current card). */
  remaining: number;
  /** True when the engine has drained its queue. */
  isComplete: boolean;
  /**
   * Live lookup: current queue position of `phraseId`, or `null` if it's
   * not in the remaining queue (dropped / already-drawn / never-enqueued).
   */
  getLiveSlotsAhead: (phraseId: string) => number | null;
}

/**
 * Core session hook shared by web + mobile. Owns the session engine +
 * in-memory progress store for a given deck, and exposes the slim surface
 * `usePhraseDisplay` needs. Session-history / sidebar plumbing lives in a
 * web-only wrapper that composes this hook.
 */
export const useLessonSession = (
  deck: Phrase[],
  options: UseLessonSessionOptions = {},
): UseLessonSessionResult => {
  if (deck.length === 0) {
    throw new Error('useLessonSession: deck must contain at least one phrase');
  }

  const { onEvent, onPresentationStart, completedLessonCount = 0 } = options;

  const completedLessonCountRef = useRef(completedLessonCount);
  completedLessonCountRef.current = completedLessonCount;

  // Engine + store are imperative and identity-stable across renders. Built
  // once per mount; we do not rebuild when `deck` identity changes (the
  // engine owns queue state that would be lost on rebuild). Consumers that
  // need to switch decks should remount this component.
  const engineRef = useRef<SessionEngine | null>(null);
  if (engineRef.current === null) {
    const store = createInMemoryProgressStore();
    engineRef.current = createSessionEngine(deck, store, {
      getCompletedLessonCount: () => completedLessonCountRef.current,
    });
  }

  /**
   * In React 18+ Strict Mode the `useState(() => init())` lazy initializer
   * can run **twice**; each call to `pickNext()` mutates the engine. A second
   * `pickNext` advances the queue and `currentPhraseId` so the on-screen
   * phrase and the engine can disagree — `onEvent` then skips requeue
   * (`event.phraseId !== currentPhraseId`) and `getQueuePosition` is null.
   * Guard so `pickNext` runs at most once for the first card.
   */
  const firstPhraseRef = useRef<Phrase | null>(null);
  if (firstPhraseRef.current === null) {
    const first = engineRef.current!.pickNext();
    if (!first) {
      throw new Error('useLessonSession: engine returned no phrases');
    }
    firstPhraseRef.current = first;
  }
  const [currentPhrase, setCurrentPhrase] = useState<Phrase>(firstPhraseRef.current);
  const [presentationVersion, setPresentationVersion] = useState(1);
  const [isComplete, setIsComplete] = useState(false);
  const [remaining, setRemaining] = useState<number>(() =>
    engineRef.current!.remaining(),
  );

  const onEventRef = useRef<typeof onEvent>(onEvent);
  onEventRef.current = onEvent;

  const onPhraseEvent = useCallback((event: PhraseEvent): void => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.onEvent(event);
    if (
      getDefaultLearningPipelineDebug() &&
      event.eventType !== 'practice' &&
      engine.getCurrentPresentedPhraseId() != null &&
      event.phraseId !== engine.getCurrentPresentedPhraseId()
    ) {
      logSessionEnginePhraseMismatch({
        eventPhraseId: event.phraseId,
        currentPresentedPhraseId: engine.getCurrentPresentedPhraseId()!,
      });
    }
    const slotsAheadAtEvent = engine.getQueuePosition(event.phraseId);
    const liveSlotsAhead = engine.getQueuePosition(event.phraseId);
    onEventRef.current?.(event, { slotsAheadAtEvent, liveSlotsAhead });
    setRemaining(engine.remaining());
  }, []);

  const advance = useCallback((): void => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = engine.pickNext();
    if (next) {
      setCurrentPhrase(next);
      setPresentationVersion((v) => v + 1);
      setRemaining(engine.remaining());
    } else {
      setIsComplete(true);
      setRemaining(0);
    }
  }, []);

  const getLiveSlotsAhead = useCallback((phraseId: string): number | null => {
    return engineRef.current?.getQueuePosition(phraseId) ?? null;
  }, []);

  // Stable 1-element array keyed on currentPhrase identity; avoids a
  // useMemo dep since the reference only changes when the phrase does.
  const phrasesRef = useRef<[Phrase]>([currentPhrase]);
  if (phrasesRef.current[0] !== currentPhrase) {
    phrasesRef.current = [currentPhrase];
  }

  return {
    currentPhrase,
    phrases: phrasesRef.current,
    presentationVersion,
    onPhraseEvent,
    onPresentationStart,
    advance,
    remaining,
    isComplete,
    getLiveSlotsAhead,
  };
};
