'use client';

import { useCallback, useRef, useState } from 'react';
import { isAccuracySuccess } from './accuracy';
import {
  getDefaultLearningPipelineDebug,
  logSessionHistoryAppend,
} from './learningPipelineDebug';
import { reduceProgress } from './mastery';
import type { GrammarGradingResult, GrammarGradingStatus } from './grammarGrading';
import type { PhraseEvent } from './events';
import type { Phrase, PhraseProgress } from './types';
import type { ItemScore } from './itemMastery';
import type { PhraseEventContext } from './useLessonSession';

export interface UseSessionHistoryOptions {
  /**
   * Pre-existing history entries used to seed the in-memory log when resuming
   * a previously persisted lesson. The internal mastery/visit refs are
   * rebuilt by replaying these entries so subsequent events derive their
   * `masteryBefore` / `isRepeatedPresentation` flags from the correct state.
   */
  initialHistory?: HistoryEntry[];
}

export interface ScoreSummary {
  accuracy: number;
  fluency: number | null;
  /** Post-event mastery from `reduceProgress` (matches the engine). */
  mastery: number;
  isAccuracySuccess: boolean;
}

/** Per-row stability transition after applying the event in `reduceProgress`. */
export interface StabilityBreakdownSnapshot {
  before: number;
  after: number;
  kind: 'attempt_ema' | 'reveal_decay' | 'practice_unchanged';
  emaInput?: 0 | 1;
}

export interface HistoryEntry {
  id: string;
  event: PhraseEvent;
  phrase: Phrase;
  scoreSummary: ScoreSummary | null;
  stabilityBreakdown: StabilityBreakdownSnapshot;
  /** Mastery immediately before / after this event (reducer output). */
  masteryBefore: number;
  masteryAfter: number;
  /**
   * True when this event was logged during a second-or-later presentation of
   * the same `phrase.name` in the current session (e.g. Pimsleur requeue or
   * linear deck wrap). Orthogonal to PracticeAttempt — a row can be both a
   * revisit AND a Try Again practice event on that revisit's card.
   */
  isRepeatedPresentation: boolean;
  /**
   * Snapshot of the in-session queue position (0-based index into the
   * remaining queue) for this phrase **immediately after** the session engine
   * processed this event. `null` when the phrase is not in the queue — e.g.
   * a mastered attempt that dropped the card, or a practice event (which
   * never reorders). Populated from `useLessonSession` `PhraseEventContext`
   * (not a ref). Static after creation; pair with a live
   * `getLiveSlotsAhead` for "session (now)".
   */
  slotsAheadAtEvent: number | null;
  /**
   * Per-session monotonic event sequence number (1-based). Stable identifier
   * for this event — displayed in the sidebar `#` column and stored in
   * `IncorrectPhraseRecord` resolution cross-references. Optional for
   * backward-compatibility with entries fetched from persistence before this
   * field was added (e.g. mobile session log viewer).
   */
  eventSeq?: number;
  /**
   * `failedAtEventSeq` values for incorrect-phrase records that became fully
   * resolved (words + grammar per tracker) on this event. Omitted when none or
   * for legacy persisted rows.
   */
  incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs?: number[];
  /**
   * Lifecycle status of the async AI grammar grading call for this event.
   * 'pending' while the request is in-flight; updated to 'success' or 'failed'
   * by `updateClassification`. Attempt events start as 'pending'; practice and
   * reveal events are 'n/a'. Optional for backward compatibility with entries
   * persisted before AI grading was introduced.
   */
  gradingStatus?: GrammarGradingStatus;
  /**
   * The AI grammar classification result. Set when `gradingStatus === 'success'`.
   */
  aiClassification?: GrammarGradingResult;
  /**
   * Per-word mastery snapshot captured immediately after the tracker updated
   * scores for this event (after AI grading resolves for attempts, synchronously
   * for reveals). Keyed by normalized word string. Optional for backward
   * compatibility — absent on old persisted entries and on practice events.
   */
  wordScoreSnapshot?: Record<string, ItemScore>;
  /**
   * Per-grammar-item mastery snapshot, same timing guarantee as
   * `wordScoreSnapshot`. Keyed by grammar item string (comma-split token).
   */
  grammarItemScoreSnapshot?: Record<string, ItemScore>;
}

export interface UseSessionHistoryResult {
  history: HistoryEntry[];
  /**
   * Called from `useLessonSession` after the engine has applied the event.
   * `ctx` is required when wiring through a lesson host.
   */
  onPhraseEvent: (event: PhraseEvent, ctx: PhraseEventContext) => void;
  /**
   * Call on each render with the currently displayed phrase. Events emitted
   * before the next call will be attributed to this phrase. Setting a ref
   * during render is safe in React — no state updates occur here.
   */
  bindCurrentPhrase: (phrase: Phrase | undefined) => void;
  /**
   * Stable callback — pass to usePhraseDisplay options. Invoked once per
   * new phrase card (not once per Try Again). Increments the per-phrase
   * visit counter so subsequent events during that card are flagged as
   * repeated presentations.
   */
  onPresentationStart: (phrase: Phrase) => void;
  clearHistory: () => void;
  /**
   * Updates the grading classification for a specific event entry.
   * Called by `useLessonSessionWithHistory` when AI grading resolves.
   *
   * @param eventSeq The per-session event sequence number to update.
   * @param status The resolved grading status ('success' or 'failed').
   * @param result The AI classification result (only set on 'success').
   * @param newlyResolvedFailedAtSeqs failedAtEventSeq values for records
   *   newly made fully-resolved by this grading event, to surface in the
   *   "fully redeemed failure events" panel of the sidebar.
   */
  updateClassification: (
    eventSeq: number,
    status: GrammarGradingStatus,
    result?: GrammarGradingResult,
    newlyResolvedFailedAtSeqs?: number[],
  ) => void;
  /**
   * Patches the per-item score snapshots onto an existing history entry.
   * Called by `useLessonSessionWithHistory` after AI grading resolves (or
   * immediately for exact-match and reveal events) so each entry records the
   * tracker state at the moment its event was processed.
   *
   * @param eventSeq The per-session event sequence number to patch.
   * @param wordScoreSnapshot Normalized word → ItemScore at event time.
   * @param grammarItemScoreSnapshot Grammar item → ItemScore at event time.
   */
  updateItemScoreSnapshot: (
    eventSeq: number,
    wordScoreSnapshot: Record<string, ItemScore>,
    grammarItemScoreSnapshot: Record<string, ItemScore>,
  ) => void;
  /**
   * Monotonic version counter that increments whenever any grading result
   * lands (success or failure). Used by `useLessonProgressPersistence` to
   * re-arm the debounced checkpoint PUT after pending gradings resolve.
   */
  gradingVersion: number;
  /**
   * Number of attempt events currently awaiting AI grading results.
   * Used by `useLessonProgressPersistence` to defer checkpoint PUTs
   * until all gradings have settled.
   */
  pendingGradingCount: number;
}

const generateId = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  return `h_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * In-memory log of every PhraseEvent emitted during the current session.
 *
 * Attempt and practice rows include a ScoreSummary: accuracy and fluency from
 * the emitted event; `mastery` is the post-event value from `reduceProgress`
 * (engine truth). Practice attempts do not change stored progress — mastery
 * before and after match — but accuracy/fluency still reflect the retry for
 * display. Each entry carries `stabilityBreakdown` and mastery before/after
 * for the sidebar or other consumers.
 */
export const useSessionHistory = (
  options: UseSessionHistoryOptions = {},
): UseSessionHistoryResult => {
  const { initialHistory } = options;

  /**
   * Lazy initializer captured once on mount: hydrate the visible history
   * AND the internal mastery/visit mirrors from the persisted entries by
   * replaying their effects. This keeps subsequent events deriving correct
   * `masteryBefore` and `isRepeatedPresentation` flags after resume.
   */
  const seededRef = useRef<{
    history: HistoryEntry[];
    visitCounts: Map<string, number>;
    progress: Map<string, PhraseProgress>;
    /**
     * Repeat flag carried over from the last presented phrase in the persisted
     * history. The resumed card never re-fires `onPresentationStart` so any
     * events emitted on it would otherwise be classified as a first
     * presentation.
     */
    currentIsRepeat: boolean;
  } | null>(null);
  if (seededRef.current === null) {
    const seededVisits = new Map<string, number>();
    const seededProgress = new Map<string, PhraseProgress>();
    let seededIsRepeat = false;
    if (initialHistory && initialHistory.length > 0) {
      let lastPhraseName: string | null = null;
      for (const entry of initialHistory) {
        const key = entry.phrase.name;
        if (key !== lastPhraseName) {
          seededVisits.set(key, (seededVisits.get(key) ?? 0) + 1);
          lastPhraseName = key;
        }
        const next = reduceProgress(
          seededProgress.get(key) ?? null,
          entry.event,
        );
        seededProgress.set(key, next);
      }
      const lastEntry = initialHistory[initialHistory.length - 1]!;
      seededIsRepeat = lastEntry.isRepeatedPresentation;
    }
    seededRef.current = {
      history: initialHistory ? [...initialHistory] : [],
      visitCounts: seededVisits,
      progress: seededProgress,
      currentIsRepeat: seededIsRepeat,
    };
  }

  const [history, setHistory] = useState<HistoryEntry[]>(
    () => seededRef.current!.history,
  );
  const [gradingVersion, setGradingVersion] = useState(0);
  const phraseRef = useRef<Phrase | undefined>(undefined);
  /**
   * Per-phrase presentation counter. Incremented in `onPresentationStart`
   * for each new card shown (not per Try Again). Events appended while
   * count > 1 are flagged as repeated presentations.
   */
  const visitCountsRef = useRef<Map<string, number>>(
    seededRef.current!.visitCounts,
  );
  /** Whether the currently displayed card is a revisit of a previous one. */
  const currentIsRepeatRef = useRef(seededRef.current!.currentIsRepeat);
  /**
   * Per-phrase progress mirror used to compute stability breakdowns and
   * mastery before/after for each history entry.
   */
  const progressByPhraseRef = useRef<Map<string, PhraseProgress>>(
    seededRef.current!.progress,
  );

  const onPhraseEvent = useCallback(
    (event: PhraseEvent, ctx: PhraseEventContext): void => {
      const phrase = phraseRef.current;
      if (!phrase) return;

      const prevProgress = progressByPhraseRef.current.get(phrase.name) ?? null;
      const nextProgress = reduceProgress(prevProgress, event);
      progressByPhraseRef.current.set(phrase.name, nextProgress);

      const stabilityBefore = prevProgress?.stabilityScore ?? 0;
      const masteryBefore = prevProgress?.masteryScore ?? 0;
      const masteryAfter = nextProgress.masteryScore;

      let stabilityBreakdown: StabilityBreakdownSnapshot;
      if (event.eventType === 'attempt') {
        stabilityBreakdown = {
          kind: 'attempt_ema',
          before: stabilityBefore,
          after: nextProgress.stabilityScore,
          emaInput: event.isAccuracySuccess ? 1 : 0,
        };
      } else if (event.eventType === 'reveal') {
        stabilityBreakdown = {
          kind: 'reveal_decay',
          before: stabilityBefore,
          after: nextProgress.stabilityScore,
        };
      } else {
        stabilityBreakdown = {
          kind: 'practice_unchanged',
          before: stabilityBefore,
          after: nextProgress.stabilityScore,
        };
      }

      let scoreSummary: ScoreSummary | null = null;
      if (event.eventType === 'attempt') {
        scoreSummary = {
          accuracy: event.accuracyScore,
          fluency: event.fluencyScore,
          mastery: masteryAfter,
          isAccuracySuccess: event.isAccuracySuccess,
        };
      } else if (event.eventType === 'practice') {
        const acc = event.accuracyBreakdown.accuracy;
        scoreSummary = {
          accuracy: acc,
          fluency: event.fluencyScore,
          mastery: masteryAfter,
          isAccuracySuccess: isAccuracySuccess(acc),
        };
      }

      const slotsAheadAtEvent = ctx.slotsAheadAtEvent;
      const eventSeq = ctx.eventSeq;

      if (getDefaultLearningPipelineDebug()) {
        const transcriptStr =
          event.eventType === 'reveal'
            ? ''
            : (event as { transcript: string[] }).transcript.join(' ');
        logSessionHistoryAppend({
          eventType: event.eventType,
          phraseId: phrase.name,
          transcriptPreview: transcriptStr,
          slotsSessionLog: ctx.slotsAheadAtEvent,
          slotsSessionNow: ctx.liveSlotsAhead,
        });
      }

      const gradingStatus: GrammarGradingStatus =
        event.eventType === 'attempt' ? 'pending' : 'n/a';

      const entry: HistoryEntry = {
        id: generateId(),
        event,
        phrase,
        scoreSummary,
        stabilityBreakdown,
        masteryBefore,
        masteryAfter,
        isRepeatedPresentation: currentIsRepeatRef.current,
        slotsAheadAtEvent,
        eventSeq,
        gradingStatus,
        ...(ctx.incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs != null &&
        ctx.incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs.length > 0
          ? {
              incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs: [
                ...ctx.incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs,
              ],
            }
          : {}),
        ...(ctx.itemScoreSnapshots != null
          ? {
              wordScoreSnapshot: ctx.itemScoreSnapshots.wordScoreSnapshot,
              grammarItemScoreSnapshot: ctx.itemScoreSnapshots.grammarItemScoreSnapshot,
            }
          : {}),
      };

      setHistory((prev) => [...prev, entry]);
    },
    [],
  );

  const updateClassification = useCallback(
    (
      eventSeq: number,
      status: GrammarGradingStatus,
      result?: GrammarGradingResult,
      newlyResolvedFailedAtSeqs?: number[],
    ): void => {
      setHistory((prev) =>
        prev.map((entry) => {
          if (entry.eventSeq !== eventSeq) return entry;
          const updated: HistoryEntry = {
            ...entry,
            gradingStatus: status,
            ...(result !== undefined ? { aiClassification: result } : {}),
            ...(newlyResolvedFailedAtSeqs && newlyResolvedFailedAtSeqs.length > 0
              ? {
                  incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs: [
                    ...(entry.incorrectPhraseRecordsFullyResolvedFailedAtEventSeqs ?? []),
                    ...newlyResolvedFailedAtSeqs,
                  ],
                }
              : {}),
          };
          return updated;
        }),
      );
      setGradingVersion((v) => v + 1);
    },
    [],
  );

  const updateItemScoreSnapshot = useCallback(
    (
      eventSeq: number,
      wordScoreSnapshot: Record<string, ItemScore>,
      grammarItemScoreSnapshot: Record<string, ItemScore>,
    ): void => {
      setHistory((prev) =>
        prev.map((entry) => {
          if (entry.eventSeq !== eventSeq) return entry;
          return { ...entry, wordScoreSnapshot, grammarItemScoreSnapshot };
        }),
      );
    },
    [],
  );

  const bindCurrentPhrase = useCallback(
    (phrase: Phrase | undefined): void => {
      phraseRef.current = phrase;
    },
    [],
  );

  const onPresentationStart = useCallback((phrase: Phrase): void => {
    const prev = visitCountsRef.current.get(phrase.name) ?? 0;
    const next = prev + 1;
    visitCountsRef.current.set(phrase.name, next);
    currentIsRepeatRef.current = next > 1;
  }, []);

  const clearHistory = useCallback((): void => {
    visitCountsRef.current.clear();
    currentIsRepeatRef.current = false;
    progressByPhraseRef.current.clear();
    setHistory([]);
  }, []);

  const pendingGradingCount = history.filter(
    (e) => e.gradingStatus === 'pending',
  ).length;

  return {
    history,
    onPhraseEvent,
    bindCurrentPhrase,
    onPresentationStart,
    clearHistory,
    updateClassification,
    updateItemScoreSnapshot,
    gradingVersion,
    pendingGradingCount,
  };
};
