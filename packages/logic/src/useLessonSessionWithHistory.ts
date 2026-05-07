'use client';

import { useCallback } from 'react';
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
  const {
    history: historyEntries,
    onPhraseEvent,
    onPresentationStart,
    clearHistory,
    bindCurrentPhrase,
  } = useSessionHistory();

  const onEvent = useCallback(
    (event: PhraseEvent, ctx: PhraseEventContext) => {
      onPhraseEvent(event, ctx);
    },
    [onPhraseEvent],
  );

  const core = useCoreLessonSession(deck, {
    onEvent,
    onPresentationStart,
    initialCheckpoint: opts.initialCheckpoint,
  });

  return {
    ...core,
    history: historyEntries,
    clearHistory,
    bindCurrentPhrase,
  };
};
