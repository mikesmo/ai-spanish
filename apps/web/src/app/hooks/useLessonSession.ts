"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createInMemoryProgressStore,
  createSessionEngine,
  type Phrase,
  type PhraseEvent,
  type SessionEngine,
} from "@ai-spanish/logic";
import {
  useSessionHistory,
  type HistoryEntry,
  type UseSessionHistoryResult,
} from "./useSessionHistory";

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
  /** Wire to `usePhraseDisplay.onPresentationStart`. */
  onPresentationStart: (phrase: Phrase) => void;
  /** Draws the next phrase from the engine queue. No-op when complete. */
  advance: () => void;
  /** Phrases remaining in the queue (excludes the current card). */
  remaining: number;
  /** True when the engine has drained its queue. */
  isComplete: boolean;
  /**
   * Live lookup: current queue position of `phraseId`, or `null` if it's not
   * in the remaining queue (dropped / already-drawn / never-enqueued).
   * Re-read by the history sidebar on each render (gated on
   * `presentationVersion`).
   */
  getLiveSlotsAhead: (phraseId: string) => number | null;
  /** Session history plumbing surfaced for the sidebar. */
  history: HistoryEntry[];
  clearHistory: UseSessionHistoryResult["clearHistory"];
  bindCurrentPhrase: UseSessionHistoryResult["bindCurrentPhrase"];
}

/**
 * Lesson host hook. Owns the session engine + progress store + session
 * history for a given deck, and exposes the slim surface `PhraseDisplay`
 * needs. The store is currently in-memory; the `ProgressStore` interface is
 * the drop-in seam for a persisted impl later.
 */
export const useLessonSession = (
  deck: Phrase[],
): UseLessonSessionResult => {
  if (deck.length === 0) {
    throw new Error("useLessonSession: deck must contain at least one phrase");
  }

  const history = useSessionHistory();

  /**
   * Engine + store are imperative and identity-stable across renders. Built
   * once per mount; we do not rebuild when `deck` identity changes (the
   * engine owns queue state that would be lost on rebuild). Consumers that
   * need to switch decks should remount this component.
   */
  const engineRef = useRef<SessionEngine | null>(null);
  if (engineRef.current === null) {
    const store = createInMemoryProgressStore();
    engineRef.current = createSessionEngine(deck, store);
  }

  // Initial draw runs once via the useState initializer (StrictMode-safe,
  // unlike a render-body side effect). The engine is non-null by the time
  // this runs because the ref assignment above precedes useState.
  const [currentPhrase, setCurrentPhrase] = useState<Phrase>(() => {
    const first = engineRef.current!.pickNext();
    if (!first) {
      throw new Error("useLessonSession: engine returned no phrases");
    }
    return first;
  });
  const [presentationVersion, setPresentationVersion] = useState(1);
  const [isComplete, setIsComplete] = useState(false);
  const [remaining, setRemaining] = useState<number>(
    () => engineRef.current!.remaining(),
  );

  // Bind the slots-ahead snapshot so every HistoryEntry captures its
  // post-event queue position. `engine.onEvent` runs BEFORE we forward to
  // history inside `onPhraseEvent`, so the snapshot reflects the updated
  // queue.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    history.bindSlotsAheadSnapshot((phraseId) =>
      engine.getQueuePosition(phraseId),
    );
    return () => {
      history.bindSlotsAheadSnapshot(null);
    };
  }, [history]);

  const onPhraseEvent = useCallback(
    (event: PhraseEvent): void => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.onEvent(event);
      history.onPhraseEvent(event);
      setRemaining(engine.remaining());
    },
    [history],
  );

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
    onPresentationStart: history.onPresentationStart,
    advance,
    remaining,
    isComplete,
    getLiveSlotsAhead,
    history: history.history,
    clearHistory: history.clearHistory,
    bindCurrentPhrase: history.bindCurrentPhrase,
  };
};
