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
   *
   * If the checkpoint includes a `history` array, the in-memory session log
   * (sidebar) is also seeded from it so the learner sees their full event
   * trail after a mid-flight resume.
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
  const initialHistory =
    opts.initialCheckpoint != null && opts.initialCheckpoint.history != null
      ? (opts.initialCheckpoint.history as unknown as HistoryEntry[])
      : undefined;

  const {
    history: historyEntries,
    onPhraseEvent,
    onPresentationStart,
    clearHistory,
    bindCurrentPhrase,
  } = useSessionHistory({ initialHistory });

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

  /**
   * Override the core checkpoint serializer so the persisted blob always
   * contains the live history alongside the engine state. Resume flows pick
   * the history back up via `initialHistory` above.
   */
  const coreGetSessionCheckpoint = core.getSessionCheckpoint;
  const getSessionCheckpoint = useCallback(
    (meta: { lessonId: string; deckFingerprint?: string }) => {
      const cp = coreGetSessionCheckpoint(meta);
      /**
       * `HistoryEntry.phrase.Spanish.recognitionHints` is optional at the
       * runtime type level but required (with default) on the schema-parsed
       * type. The shapes are identical after JSON serialization, so we cast
       * here rather than threading a separate runtime-only checkpoint type.
       */
      return {
        ...cp,
        history: historyEntries,
      } as unknown as SessionCheckpointParsed;
    },
    [coreGetSessionCheckpoint, historyEntries],
  );

  return {
    ...core,
    getSessionCheckpoint,
    history: historyEntries,
    clearHistory,
    bindCurrentPhrase,
  };
};
