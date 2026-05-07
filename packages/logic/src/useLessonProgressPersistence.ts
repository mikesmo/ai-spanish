'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  putLessonProgressCheckpoint,
  type LessonProgressFetcher,
} from './lessonProgressClient';
import {
  getDefaultLearningPipelineDebug,
  logCheckpointDeferred,
  logCheckpointFlushing,
} from './learningPipelineDebug';
import type { UseLessonSessionWithHistoryResult } from './useLessonSessionWithHistory';

export interface UseLessonProgressPersistenceOptions {
  /** The live session handle — only stable fields are read as effect deps. */
  session: UseLessonSessionWithHistoryResult;
  lessonId: string;
  /** Pre-computed fingerprint of the loaded deck (stable across renders). */
  deckFingerprint: string;
  /** Platform-specific HTTP transport (cookies on web, Bearer on mobile). */
  fetcher: LessonProgressFetcher;
}

export interface UseLessonProgressPersistenceResult {
  /**
   * Immediately PUT the latest checkpoint without waiting for the debounce.
   * Call from platform-specific exit/background listeners. Always fires
   * regardless of pending grading count — we do not want to lose state on
   * tab close. Pending entries serialize with `gradingStatus: 'pending'` and
   * downgrade to `'failed'` on resume (alignment-based fallback is used).
   */
  flush: (options?: { keepalive?: boolean }) => void;
}

/**
 * Shared hook that keeps the server-side checkpoint in sync with the live
 * lesson session. Works on both web and mobile — the only platform-specific
 * piece is the `fetcher` transport.
 *
 * - Debounced PUT (450 ms) on every meaningful state change.
 * - Skips the debounced PUT while `session.pendingGradingCount > 0` so the
 *   checkpoint is not saved with unclassified grammar. Re-fires when
 *   `session.gradingVersion` bumps (last grading result landed).
 * - `flush()` always fires immediately (for lifecycle exit events) even with
 *   pending gradings — we prefer a partial checkpoint over losing all state.
 * - No-ops once `session.isComplete` — the completion handler owns cleanup.
 */
export function useLessonProgressPersistence({
  session,
  lessonId,
  deckFingerprint,
  fetcher,
}: UseLessonProgressPersistenceOptions): UseLessonProgressPersistenceResult {
  // Keep a ref so flush() and the debounced effect always see the latest
  // session state without adding session object identity to any dep array.
  const sessionSnapRef = useRef(session);
  sessionSnapRef.current = session;

  const deckFingerprintRef = useRef(deckFingerprint);
  deckFingerprintRef.current = deckFingerprint;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const flush = useCallback((options?: { keepalive?: boolean }): void => {
    const snap = sessionSnapRef.current;
    if (snap.isComplete) return;
    let cp;
    try {
      cp = snap.getSessionCheckpoint({
        lessonId,
        deckFingerprint: deckFingerprintRef.current,
      });
    } catch {
      return;
    }
    void putLessonProgressCheckpoint(fetcherRef.current, cp, options);
  }, [lessonId]);

  // Debounced PUT — fires 450 ms after any meaningful session change.
  // Skipped while grading results are still pending so the checkpoint always
  // contains fully-classified data. `gradingVersion` re-arms the timer when
  // the last in-flight grading result arrives.
  useEffect(() => {
    if (session.isComplete) return;

    const pendingCount = session.pendingGradingCount;
    if (pendingCount > 0) {
      if (getDefaultLearningPipelineDebug()) {
        logCheckpointDeferred({ pendingGradingCount: pendingCount });
      }
      return;
    }

    if (getDefaultLearningPipelineDebug()) {
      logCheckpointFlushing({ gradingVersion: session.gradingVersion });
    }

    const tid = setTimeout(() => {
      flush();
    }, 450);
    return () => clearTimeout(tid);
  }, [
    flush,
    session.history.length,
    session.remaining,
    session.presentationVersion,
    session.isComplete,
    session.pendingGradingCount,
    session.gradingVersion,
  ]);

  return { flush };
}
