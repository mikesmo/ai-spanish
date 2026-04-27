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
import type { SessionCheckpointParsed } from './schemas/sessionCheckpoint';

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

export interface UseLessonSessionWithHistoryOptions {
  /**
   * When provided the session engine is hydrated from this snapshot instead of
   * starting fresh. Pass `null` to explicitly clear a stored checkpoint.
   */
  initialCheckpoint?: SessionCheckpointParsed | null;
}

/**
 * Lesson host hook: composes `useLessonSession` with `useSessionHistory` so
 * every phrase event is mirrored into `history` (web sidebar, mobile, etc.).
 */
export const useLessonSessionWithHistory = (
  deck: Phrase[],
  opts: UseLessonSessionWithHistoryOptions = {},
): UseLessonSessionWithHistoryResult => {
  const [completedLessonCount, setCompletedLessonCount] = useState(
    opts.initialCheckpoint?.completedLessonCount ?? 0,
  );
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
    initialCheckpoint: opts.initialCheckpoint,
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
