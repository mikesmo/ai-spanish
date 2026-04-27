'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Phrase } from './types';
import type { PhraseEvent } from './events';
import {
  useLessonSession as useCoreLessonSession,
  type PhraseEventContext,
  type UseLessonSessionResult as CoreUseLessonSessionResult,
} from './useLessonSession';
import {
  useSessionHistory,
  type HistoryEntry,
  type UseSessionHistoryResult,
} from './useSessionHistory';

export interface UseLessonSessionWithHistoryResult
  extends CoreUseLessonSessionResult {
  /** Session history: in-memory log for debug UI or future surfaces. */
  history: HistoryEntry[];
  clearHistory: UseSessionHistoryResult['clearHistory'];
  bindCurrentPhrase: UseSessionHistoryResult['bindCurrentPhrase'];
  /**
   * Lessons fully completed before this run. Bumps once when the queue drains;
   * pass to session history / sidebar for SRS copy. Persist between visits in
   * production.
   */
  completedLessonCount: number;
}

/**
 * Lesson host hook: composes `useLessonSession` with `useSessionHistory` so
 * every phrase event is mirrored into `history` (web sidebar, mobile, etc.).
 */
export const useLessonSessionWithHistory = (
  deck: Phrase[],
): UseLessonSessionWithHistoryResult => {
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
