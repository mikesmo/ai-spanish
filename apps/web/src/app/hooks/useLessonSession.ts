"use client";

import { useCallback } from "react";
import {
  useLessonSession as useCoreLessonSession,
  type Phrase,
  type PhraseEvent,
  type PhraseEventContext,
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

  // `onEvent` runs in the same turn as `engine.onEvent` and receives
  // `PhraseEventContext` with `getQueuePosition` from the live engine.
  const onEvent = useCallback(
    (event: PhraseEvent, ctx: PhraseEventContext) => {
      history.onPhraseEvent(event, ctx);
    },
    [history],
  );

  const core = useCoreLessonSession(deck, {
    onEvent,
    onPresentationStart: history.onPresentationStart,
  });

  return {
    ...core,
    history: history.history,
    clearHistory: history.clearHistory,
    bindCurrentPhrase: history.bindCurrentPhrase,
  };
};
