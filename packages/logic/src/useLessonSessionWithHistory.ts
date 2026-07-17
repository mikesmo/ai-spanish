'use client';

import { useCallback, useMemo, useRef } from 'react';
import type { Phrase } from './types';
import type { PhraseEvent } from './events';
import {
  useLessonSession as useCoreLessonSession,
  type ApplyGradingResultReturn,
  type PhraseEventContext,
  type UseLessonSessionOptions as CoreUseLessonSessionOptions,
  type UseLessonSessionResult as CoreUseLessonSessionResult,
} from './useLessonSession';
import {
  useSessionHistory,
  type HistoryEntry,
  type UseSessionHistoryResult,
} from './useSessionHistory';
import {
  useGrammarGrading,
  type PostGrammarGrading,
} from './useGrammarGrading';
import type { GrammarGradingRequest, GrammarGradingResult } from './grammarGrading';
import type { SessionCheckpointParsed } from './schemas/sessionCheckpoint';

export interface UseLessonSessionWithHistoryResult
  extends CoreUseLessonSessionResult {
  /** Session history: in-memory log for debug UI or future surfaces. */
  history: HistoryEntry[];
  clearHistory: UseSessionHistoryResult['clearHistory'];
  bindCurrentPhrase: UseSessionHistoryResult['bindCurrentPhrase'];
  /**
   * Number of attempt events currently awaiting AI grading results.
   * The checkpoint debounce is deferred while this is > 0.
   */
  pendingGradingCount: number;
  /**
   * Monotonic version counter that increments each time any grading result
   * lands. Used by `useLessonProgressPersistence` to re-arm the debounced
   * checkpoint PUT after pending gradings resolve.
   */
  gradingVersion: number;
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
  /**
   * Lifetime (cross-lesson) word/grammar mastery to seed the tracker with.
   * See `UseLessonSessionOptions.initialItemScores` — forwarded as-is.
   */
  initialItemScores?: CoreUseLessonSessionOptions['initialItemScores'];
  /**
   * Platform-specific POST function for the grammar grading endpoint.
   * Required to enable AI grading; when omitted, all attempt events fall
   * back to the alignment-based classifier immediately.
   */
  postGrammarGrading?: PostGrammarGrading;
}

const noOpPost: PostGrammarGrading = async (_req: GrammarGradingRequest) => {
  throw new Error('No postGrammarGrading provided');
};

/**
 * Lesson host hook: composes `useLessonSession` with `useSessionHistory` and
 * `useGrammarGrading` so every phrase attempt is:
 *   1. Mirrored into `history` (web sidebar, mobile, etc.)
 *   2. Queued for async AI grammar classification
 *   3. Updated in history + tracker when grading resolves
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
    onPhraseEvent: historyOnPhraseEvent,
    onPresentationStart,
    clearHistory,
    bindCurrentPhrase,
    updateClassification,
    updateItemScoreSnapshot,
    gradingVersion,
    pendingGradingCount,
  } = useSessionHistory({ initialHistory });

  const deckById = useMemo(() => new Map(deck.map((p) => [p.name, p])), [deck]);

  /**
   * Ref to the core session's `applyGradingResult`. Set after `useCoreLessonSession`
   * is called. Using a ref breaks the circular dependency between `onEvent`
   * (which needs `kickoff`) and `core` (which needs `onEvent`).
   */
  const emptySnapshot = { wordScoreSnapshot: {}, grammarItemScoreSnapshot: {} };
  const applyGradingResultRef = useRef<CoreUseLessonSessionResult['applyGradingResult']>(
    (_eventSeq, _result) => ({ newlyResolvedFailedAtSeqs: [], itemScoreSnapshot: emptySnapshot }),
  );

  /**
   * Ref to `kickoff` from `useGrammarGrading`. Set after `useGrammarGrading`
   * is called so `onEvent` can call it without being in the deps array.
   */
  const kickoffRef = useRef<(request: GrammarGradingRequest) => void>(
    (_request: GrammarGradingRequest) => undefined,
  );

  const updateClassificationRef = useRef(updateClassification);
  updateClassificationRef.current = updateClassification;

  const updateItemScoreSnapshotRef = useRef(updateItemScoreSnapshot);
  updateItemScoreSnapshotRef.current = updateItemScoreSnapshot;

  const onGradingResult = useCallback(
    (eventSeq: number, result: GrammarGradingResult): void => {
      const { newlyResolvedFailedAtSeqs, itemScoreSnapshot } = applyGradingResultRef.current(
        eventSeq,
        result,
      ) as ApplyGradingResultReturn;
      updateClassificationRef.current(eventSeq, 'success', result, newlyResolvedFailedAtSeqs);
      updateItemScoreSnapshotRef.current(
        eventSeq,
        itemScoreSnapshot.wordScoreSnapshot,
        itemScoreSnapshot.grammarItemScoreSnapshot,
      );
    },
    [],
  );

  const onGradingFailure = useCallback(
    (eventSeq: number, _error: unknown): void => {
      const { newlyResolvedFailedAtSeqs, itemScoreSnapshot } = applyGradingResultRef.current(
        eventSeq,
        null,
      ) as ApplyGradingResultReturn;
      updateClassificationRef.current(eventSeq, 'failed', undefined, newlyResolvedFailedAtSeqs);
      updateItemScoreSnapshotRef.current(
        eventSeq,
        itemScoreSnapshot.wordScoreSnapshot,
        itemScoreSnapshot.grammarItemScoreSnapshot,
      );
    },
    [],
  );

  const { kickoff } = useGrammarGrading({
    post: opts.postGrammarGrading ?? noOpPost,
    onResult: onGradingResult,
    onFailure: onGradingFailure,
  });

  kickoffRef.current = kickoff;

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const onEvent = useCallback(
    (event: PhraseEvent, ctx: PhraseEventContext): void => {
      historyOnPhraseEvent(event, ctx);

      if (event.eventType === 'attempt' && ctx.eventSeq != null) {
        const phrase = deckById.get(event.phraseId);
        if (phrase) {
          if (event.missingWords.length === 0 && event.extraWords.length === 0) {
            // Exact word match — grammar was fully demonstrated.
            // Resolve immediately without an AI call.
            const emptyResult = { failedGrammarItems: [], wordMistakes: [] };
            const { newlyResolvedFailedAtSeqs, itemScoreSnapshot } = applyGradingResultRef.current(
              ctx.eventSeq,
              emptyResult,
            );
            updateClassificationRef.current(
              ctx.eventSeq,
              'success',
              emptyResult,
              newlyResolvedFailedAtSeqs,
            );
            updateItemScoreSnapshotRef.current(
              ctx.eventSeq,
              itemScoreSnapshot.wordScoreSnapshot,
              itemScoreSnapshot.grammarItemScoreSnapshot,
            );
          } else if (optsRef.current.postGrammarGrading) {
            const grammarItems = phrase.Spanish.grammar
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            const newGrammarItems = (phrase.Spanish.newGrammar ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            const request: GrammarGradingRequest = {
              phraseId: phrase.name,
              eventSeq: ctx.eventSeq,
              englishText: phrase.English.question,
              expectedSpanish: phrase.Spanish.answer,
              grammarItems,
              newGrammarItems,
              userTranscript: event.transcript,
              missingWords: event.missingWords,
              extraWords: event.extraWords,
            };
            kickoffRef.current(request);
          }
        }
      }
    },
    [historyOnPhraseEvent, deckById],
  );

  const core = useCoreLessonSession(deck, {
    onEvent,
    onPresentationStart,
    initialCheckpoint: opts.initialCheckpoint,
    initialItemScores: opts.initialItemScores,
  });

  applyGradingResultRef.current = core.applyGradingResult;

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
    pendingGradingCount,
    gradingVersion,
  };
};
