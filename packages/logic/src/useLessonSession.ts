'use client';

import { useCallback, useRef, useState } from 'react';
import {
  getDefaultLearningPipelineDebug,
  logSessionEnginePhraseMismatch,
} from './learningPipelineDebug';
import {
  buildDeckFingerprint,
  createSessionEngine,
  type SessionEngine,
} from './sessionEngine';
import { createInMemoryProgressStore } from './progressStore';
import type { Phrase } from './types';
import type { PhraseEvent } from './events';
import type { SessionCheckpointParsed } from './schemas/sessionCheckpoint';
import {
  createIncorrectPhraseTracker,
  type IncorrectPhraseRecord,
} from './incorrectPhraseTracker';
import type { ItemScore } from './itemMastery';
import type { GrammarGradingResult, PendingGradingEventInfo } from './grammarGrading';
import { normalizeStr } from './comparison';

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
  /**
   * Per-session monotonic event sequence number (1-based). Increments once
   * per PhraseEvent (attempt / practice / reveal). Used as the stable
   * reference ID surfaced in the history sidebar `#` column and in
   * `IncorrectPhraseRecord` resolution cross-references.
   */
  eventSeq: number;
  /**
   * Sorted unique `failedAtEventSeq` values for incorrect-phrase records that
   * became `isFullyResolved` on this event (attempt/reveal with tracker run).
   * Empty when none; omitted or empty for practice.
   */
  incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs?: readonly number[];
  /**
   * Per-item score snapshot captured immediately after tracker scores were
   * updated for this event. Present for reveal events (synchronous) and
   * exact-match attempt events. Absent for async-AI attempts (the snapshot
   * arrives later via `updateItemScoreSnapshot`) and practice events.
   */
  itemScoreSnapshots?: {
    wordScoreSnapshot: Record<string, ItemScore>;
    grammarItemScoreSnapshot: Record<string, ItemScore>;
  };
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
   * When provided the engine is hydrated from this snapshot instead of
   * starting fresh. Every phrase id in the checkpoint must exist in `deck`;
   * the hook throws if any id is unrecognised. Pass `null` to clear a stored
   * checkpoint (treated as missing).
   */
  initialCheckpoint?: SessionCheckpointParsed | null;
}

export interface ApplyGradingResultReturn {
  /**
   * `failedAtEventSeq` values for incorrect-phrase records that became fully
   * resolved as a result of this grading call. Used by the session-with-history
   * layer to update the history entry's "fully redeemed" panel.
   */
  newlyResolvedFailedAtSeqs: number[];
  /**
   * Per-item score snapshot captured immediately after the tracker applied
   * grading for this event. Passed by the session-with-history layer to
   * `updateItemScoreSnapshot` so the history entry records the tracker state
   * at the moment the event was processed.
   */
  itemScoreSnapshot: {
    wordScoreSnapshot: Record<string, ItemScore>;
    grammarItemScoreSnapshot: Record<string, ItemScore>;
  };
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
  /**
   * Snapshot of the current engine + progress store state. Pass back as
   * `initialCheckpoint` to resume the session from this point.
   * `deckFingerprint` is auto-computed from `deck` if not overridden.
   * Includes `incorrectPhraseRecords` for persistence and analytics.
   */
  getSessionCheckpoint: (meta: {
    lessonId: string;
    deckFingerprint?: string;
  }) => SessionCheckpointParsed;
  /**
   * Live snapshot of all incorrect-phrase records for this session, including
   * fully-resolved ones. Updates reactively after every Attempt event and
   * after each grading result lands.
   * Consumed by the web history sidebar to display resolution info.
   */
  incorrectPhraseRecords: readonly IncorrectPhraseRecord[];
  /**
   * Apply an AI grading result (or null for fallback) for a specific attempt
   * event. Calls `tracker.applyAiGrading` or `tracker.applyFallbackClassification`
   * and removes newly fully-resolved phrases from the session queue.
   *
   * @param eventSeq The per-session event sequence number of the graded attempt.
   * @param result The AI result, or null to apply the alignment-based fallback.
   * @returns `newlyResolvedFailedAtSeqs` — failedAtEventSeq values for records
   *   newly made fully resolved by this call.
   */
  applyGradingResult: (
    eventSeq: number,
    result: GrammarGradingResult | null,
  ) => ApplyGradingResultReturn;
}

/**
 * Builds a point-in-time snapshot of word and grammar item scores for the
 * words and grammar items in the given phrase, reading from the tracker's
 * current score maps. Only entries with a score present in the tracker are
 * included; untouched items are omitted rather than fabricated.
 */
function snapshotPhraseItemScores(
  phrase: Phrase,
  tracker: ReturnType<typeof createIncorrectPhraseTracker>,
): { wordScoreSnapshot: Record<string, ItemScore>; grammarItemScoreSnapshot: Record<string, ItemScore> } {
  const wordScores = tracker.getWordScores();
  const grammarScores = tracker.getGrammarItemScores();

  const wordScoreSnapshot: Record<string, ItemScore> = {};
  for (const w of phrase.Spanish.words) {
    const key = normalizeStr(w.word);
    const score = wordScores.get(key);
    if (score !== undefined) wordScoreSnapshot[key] = score;
  }

  const grammarItemScoreSnapshot: Record<string, ItemScore> = {};
  const grammarItems = phrase.Spanish.grammar
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const item of grammarItems) {
    const score = grammarScores.get(item);
    if (score !== undefined) grammarItemScoreSnapshot[item] = score;
  }

  return { wordScoreSnapshot, grammarItemScoreSnapshot };
}

/**
 * Core session hook shared by web + mobile. Owns the session engine +
 * in-memory progress store for a given deck, and exposes the slim surface
 * `usePhraseDisplay` needs. For a per-event `HistoryEntry` log (sidebar,
 * debug), compose with `useLessonSessionWithHistory`.
 */
export const useLessonSession = (
  deck: Phrase[],
  options: UseLessonSessionOptions = {},
): UseLessonSessionResult => {
  if (deck.length === 0) {
    throw new Error('useLessonSession: deck must contain at least one phrase');
  }

  const { onEvent, onPresentationStart, initialCheckpoint } = options;

  // Engine + store are imperative and identity-stable across renders. Built
  // once per mount; we do not rebuild when `deck` identity changes (the
  // engine owns queue state that would be lost on rebuild). Consumers that
  // need to switch decks should remount this component.
  const storeRef = useRef(createInMemoryProgressStore());
  const engineRef = useRef<SessionEngine | null>(null);
  const trackerRef = useRef(
    createIncorrectPhraseTracker(
      initialCheckpoint?.incorrectPhraseRecords,
      {
        wordScores: initialCheckpoint?.wordScores,
        grammarItemScores: initialCheckpoint?.grammarItemScores,
      },
    ),
  );
  /** Monotonic per-session event counter. Increments once per PhraseEvent. */
  const eventSeqRef = useRef(0);
  /**
   * Map from eventSeq → grading metadata for attempt events awaiting AI
   * grading. Populated in `onPhraseEvent` and consumed in `applyGradingResult`.
   */
  const pendingGradingMapRef = useRef(new Map<number, PendingGradingEventInfo>());
  /**
   * Per-phrase presentation visit count. Incremented by the wrapped
   * `onPresentationStart` so `onPhraseEvent` can detect first presentations
   * of `type="new"` phrases and set `canResolve = false`.
   */
  const visitCountsRef = useRef(new Map<string, number>());
  if (engineRef.current === null) {
    engineRef.current = createSessionEngine(deck, storeRef.current, {
      initialCheckpoint: initialCheckpoint ?? undefined,
    });
  }

  /**
   * In React 18+ Strict Mode the `useState(() => init())` lazy initializer
   * can run **twice**; each call to `pickNext()` mutates the engine. A second
   * `pickNext` advances the queue and `currentPhraseId` so the on-screen
   * phrase and the engine can disagree — `onEvent` then skips requeue
   * (`event.phraseId !== currentPhraseId`) and `getQueuePosition` is null.
   * Guard so `pickNext` runs at most once for the first card.
   *
   * When resuming from a checkpoint that has a `currentPresentedPhraseId`, we
   * don't need to call `pickNext` at all — the current card is already known.
   */
  const deckById = useRef(new Map(deck.map((p) => [p.name, p]))).current;
  const firstPhraseRef = useRef<Phrase | null>(null);

  if (firstPhraseRef.current === null) {
    if (initialCheckpoint?.currentPresentedPhraseId) {
      // Resume: restore the in-progress card from the checkpoint without
      // calling pickNext (which would advance the queue).
      const resumed = deckById.get(initialCheckpoint.currentPresentedPhraseId);
      if (!resumed) {
        throw new Error(
          `useLessonSession: checkpoint currentPresentedPhraseId "${initialCheckpoint.currentPresentedPhraseId}" not found in deck`,
        );
      }
      // If the checkpoint history already has an entry for this phrase the
      // user left from the post-attempt feedback screen (advance() was never
      // called). Show the next phrase instead of replaying the same card.
      const resumedId = initialCheckpoint.currentPresentedPhraseId;
      const alreadyAnswered = initialCheckpoint.history?.some(
        (e) => e.phrase.name === resumedId,
      );
      if (alreadyAnswered) {
        const next = engineRef.current!.pickNext();
        firstPhraseRef.current = next ?? resumed;
      } else {
        firstPhraseRef.current = resumed;
      }
    } else {
      const first = engineRef.current!.pickNext();
      if (!first) {
        throw new Error('useLessonSession: engine returned no phrases');
      }
      firstPhraseRef.current = first;
    }
  }

  const isInitiallyComplete =
    initialCheckpoint !== null &&
    initialCheckpoint !== undefined &&
    initialCheckpoint.currentPresentedPhraseId === null &&
    initialCheckpoint.queuePhraseIds.length === 0;

  const [cardState, setCardState] = useState<{
    currentPhrase: Phrase;
    presentationVersion: number;
  }>({
    currentPhrase: firstPhraseRef.current!,
    presentationVersion: 1,
  });
  const { currentPhrase, presentationVersion } = cardState;
  const [isComplete, setIsComplete] = useState(isInitiallyComplete);
  const [remaining, setRemaining] = useState<number>(() =>
    engineRef.current!.remaining(),
  );
  const [incorrectPhraseRecords, setIncorrectPhraseRecords] = useState<
    readonly IncorrectPhraseRecord[]
  >(() => trackerRef.current.getAllRecords());

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
    const eventSeq = ++eventSeqRef.current;
    const slotsAheadAtEvent = engine.getQueuePosition(event.phraseId);
    const liveSlotsAhead = engine.getQueuePosition(event.phraseId);

    if (event.eventType === 'attempt') {
      const phrase = deckById.get(event.phraseId);
      if (phrase) {
        // For attempt events, do word-tracking synchronously so the sidebar
        // can immediately show which words were missing. Grammar classification
        // is deferred to applyGradingResult (called after AI grading returns).
        trackerRef.current.recordMissingWords(
          event.phraseId,
          phrase,
          event.missingWords,
          event.extraWords,
          event.isAccuracySuccess,
          eventSeq,
        );

        const visitCount = visitCountsRef.current.get(event.phraseId) ?? 0;
        const canResolve = !(phrase.type === 'new' && visitCount <= 1);
        const grammarItems = phrase.Spanish.grammar
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        pendingGradingMapRef.current.set(eventSeq, {
          phraseId: event.phraseId,
          grammarItems,
          missingWords: event.missingWords,
          isAccuracySuccess: event.isAccuracySuccess,
          canResolve,
          startedAtMs: Date.now(),
        });
        setIncorrectPhraseRecords(trackerRef.current.getAllRecords());
      }
    } else if (event.eventType === 'reveal') {
      const phrase = deckById.get(event.phraseId);
      if (phrase) {
        const allMissingWords = phrase.Spanish.words.map((w) => w.word);
        const visitCount = visitCountsRef.current.get(event.phraseId) ?? 0;
        const canResolve = !(phrase.type === 'new' && visitCount <= 1);
        const newlyResolvedPhraseIds = trackerRef.current.applyFallbackClassification(
          event.phraseId,
          phrase,
          allMissingWords,
          false,
          eventSeq,
          canResolve,
          'n/a',
        );
        setIncorrectPhraseRecords(trackerRef.current.getAllRecords());
        for (const resolvedId of newlyResolvedPhraseIds) {
          engine.removeAndPreventRequeue(resolvedId);
        }
        // Snapshot after scores are updated (synchronous for reveals).
        const itemScoreSnapshots = snapshotPhraseItemScores(phrase, trackerRef.current);
        onEventRef.current?.(event, {
          slotsAheadAtEvent,
          liveSlotsAhead,
          eventSeq,
          itemScoreSnapshots,
        });
        setRemaining(engine.remaining());
        return;
      }
    }

    onEventRef.current?.(event, {
      slotsAheadAtEvent,
      liveSlotsAhead,
      eventSeq,
    });
    setRemaining(engine.remaining());
  }, [deckById]);

  const advance = useCallback((): void => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = engine.pickNext();
    if (next) {
      // Update currentPhrase and presentationVersion in a single setState so
      // React always commits them in the same render. Two separate setState
      // calls are not guaranteed to batch on all React Native versions, which
      // caused the bootstrap effect to run twice per navigation (once with the
      // new phrase but the old version, then again with both updated).
      setCardState((prev) => ({
        currentPhrase: next,
        presentationVersion: prev.presentationVersion + 1,
      }));
      setRemaining(engine.remaining());
    } else {
      setIsComplete(true);
      setRemaining(0);
    }
  }, []);

  const getLiveSlotsAhead = useCallback((phraseId: string): number | null => {
    return engineRef.current?.getQueuePosition(phraseId) ?? null;
  }, []);

  const onPresentationStartRef = useRef<typeof onPresentationStart>(onPresentationStart);
  onPresentationStartRef.current = onPresentationStart;

  /**
   * Wrapped presentation-start callback: increments the local visit count for
   * `canResolve` detection before delegating to the host's callback.
   */
  const wrappedOnPresentationStart = useCallback((phrase: Phrase): void => {
    const prev = visitCountsRef.current.get(phrase.name) ?? 0;
    visitCountsRef.current.set(phrase.name, prev + 1);
    onPresentationStartRef.current?.(phrase);
  }, []);

  const getSessionCheckpoint = useCallback(
    (meta: { lessonId: string; deckFingerprint?: string }) => {
      const engine = engineRef.current!;
      const checkpoint = engine.exportCheckpoint({
        ...meta,
        deckFingerprint: meta.deckFingerprint ?? buildDeckFingerprint(deck),
      });
      return {
        ...checkpoint,
        incorrectPhraseRecords: trackerRef.current.getAllRecords() as IncorrectPhraseRecord[],
        wordScores: Object.fromEntries(trackerRef.current.getWordScores()),
        grammarItemScores: Object.fromEntries(trackerRef.current.getGrammarItemScores()),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deck],
  );

  const applyGradingResult = useCallback(
    (eventSeq: number, result: GrammarGradingResult | null): ApplyGradingResultReturn => {
      const engine = engineRef.current;
      const emptySnapshot = { wordScoreSnapshot: {}, grammarItemScoreSnapshot: {} };
      if (!engine) return { newlyResolvedFailedAtSeqs: [], itemScoreSnapshot: emptySnapshot };

      const info = pendingGradingMapRef.current.get(eventSeq);
      if (!info) return { newlyResolvedFailedAtSeqs: [], itemScoreSnapshot: emptySnapshot };
      pendingGradingMapRef.current.delete(eventSeq);

      const phrase = deckById.get(info.phraseId);
      if (!phrase) return { newlyResolvedFailedAtSeqs: [], itemScoreSnapshot: emptySnapshot };

      let newlyResolvedPhraseIds: string[];
      if (result !== null) {
        newlyResolvedPhraseIds = trackerRef.current.applyAiGrading(
          info.phraseId,
          phrase,
          result,
          info.missingWords,
          info.isAccuracySuccess,
          eventSeq,
          info.canResolve,
        );
      } else {
        newlyResolvedPhraseIds = trackerRef.current.applyFallbackClassification(
          info.phraseId,
          phrase,
          info.missingWords,
          info.isAccuracySuccess,
          eventSeq,
          info.canResolve,
          'failed',
        );
      }

      const fullySeqSet = new Set<number>();
      for (const resolvedId of newlyResolvedPhraseIds) {
        const rec = trackerRef.current.getRecord(resolvedId);
        if (rec) fullySeqSet.add(rec.failedAtEventSeq);
        engine.removeAndPreventRequeue(resolvedId);
      }
      setIncorrectPhraseRecords(trackerRef.current.getAllRecords());
      setRemaining(engine.remaining());

      const itemScoreSnapshot = snapshotPhraseItemScores(phrase, trackerRef.current);

      return {
        newlyResolvedFailedAtSeqs: Array.from(fullySeqSet).sort((a, b) => a - b),
        itemScoreSnapshot,
      };
    },
    [deckById],
  );

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
    onPresentationStart: wrappedOnPresentationStart,
    advance,
    remaining,
    isComplete,
    getLiveSlotsAhead,
    getSessionCheckpoint,
    incorrectPhraseRecords,
    applyGradingResult,
  };
};
