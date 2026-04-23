"use client";

import { useCallback } from "react";
import {
  useLessonSession as useCoreLessonSession,
  type Phrase,
  type PhraseEvent,
  type UseLessonSessionResult as CoreUseLessonSessionResult,
} from "@ai-spanish/logic";
import {
  useSessionHistory,
  type HistoryEntry,
  type UseSessionHistoryResult,
} from "./useSessionHistory";

export interface UseLessonSessionResult extends CoreUseLessonSessionResult {
  /** Session history plumbing surfaced for the sidebar. */
  history: HistoryEntry[];
  clearHistory: UseSessionHistoryResult["clearHistory"];
  bindCurrentPhrase: UseSessionHistoryResult["bindCurrentPhrase"];
}

/**
 * Web-specific lesson host hook. Composes the shared `useLessonSession`
 * core (engine + progress store) with the local `useSessionHistory` so the
 * sidebar can observe every phrase event. The mobile app uses the core
 * hook directly without history plumbing.
 */
export const useLessonSession = (
  deck: Phrase[],
): UseLessonSessionResult => {
  const history = useSessionHistory();

  // Bind history's per-event callback so the core hook calls it AFTER the
  // engine processes each event, ensuring `engine.getQueuePosition` reflects
  // the post-event queue state when history snapshots `slotsAheadAtEvent`.
  const onEvent = useCallback(
    (event: PhraseEvent) => {
      history.onPhraseEvent(event);
    },
    [history],
  );

  const core = useCoreLessonSession(deck, {
    onEvent,
    bindQueuePositionLookup: history.bindSlotsAheadSnapshot,
    onPresentationStart: history.onPresentationStart,
  });

  return {
    ...core,
    history: history.history,
    clearHistory: history.clearHistory,
    bindCurrentPhrase: history.bindCurrentPhrase,
  };
};
