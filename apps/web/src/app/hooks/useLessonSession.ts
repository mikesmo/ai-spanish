"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  /**
   * Lessons fully completed before this run. Bumps once when the queue drains;
   * pass to session history / sidebar for SRS copy. Persist between visits in
   * production.
   */
  completedLessonCount: number;
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
  const [completedLessonCount, setCompletedLessonCount] = useState(0);
  const lessonCompletionHandledRef = useRef(false);
  const {
    history: historyEntries,
    onPhraseEvent,
    onPresentationStart,
    clearHistory,
    bindCurrentPhrase,
  } = useSessionHistory(completedLessonCount);

  const onEvent = useCallback(
    (event: PhraseEvent, ctx: PhraseEventContext) => {
      onPhraseEvent(event, ctx);
    },
    [onPhraseEvent],
  );

  const core = useCoreLessonSession(deck, {
    onEvent,
    onPresentationStart,
    completedLessonCount,
  });

  useEffect(() => {
    if (core.isComplete) {
      if (!lessonCompletionHandledRef.current) {
        lessonCompletionHandledRef.current = true;
        setCompletedLessonCount((c) => c + 1);
      }
    } else {
      lessonCompletionHandledRef.current = false;
    }
  }, [core.isComplete]);

  return {
    ...core,
    completedLessonCount,
    history: historyEntries,
    clearHistory,
    bindCurrentPhrase,
  };
};
