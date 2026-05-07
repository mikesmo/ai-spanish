'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  putLessonProgressCheckpoint,
  type LessonProgressFetcher,
} from './lessonProgressClient';
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
   * Call from platform-specific exit/background listeners.
   */
  flush: (options?: { keepalive?: boolean }) => void;
}

/**
 * Shared hook that keeps the server-side checkpoint in sync with the live
 * lesson session. Works on both web and mobile — the only platform-specific
 * piece is the `fetcher` transport.
 *
 * - Debounced PUT (450 ms) on every meaningful state change.
 * - Exposes `flush()` for immediate saves triggered by platform lifecycle
 *   events (browser `pagehide`, RN `AppState` background, exit button, etc.).
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
  useEffect(() => {
    if (session.isComplete) return;
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
  ]);

  return { flush };
}
