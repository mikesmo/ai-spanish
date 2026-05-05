'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearnerQuestionContext } from './learnerQuestionPrompt';

export interface LearnerQuestionTurn {
  id: string;
  question: string;
  answer: string;
  isStreaming: boolean;
  error: string | null;
}

export type LearnerQuestionRequestBody = LearnerQuestionContext & {
  question: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export interface UseLearnerQuestionOptions {
  /** All phrase/attempt metadata sent to the model. Updated via ref every render. */
  context: LearnerQuestionContext;
  /**
   * Changing this key resets the thread and aborts any in-flight stream.
   * Use the phrase name/id so the thread resets on phrase change but persists
   * across sidebar open/close on the same phrase.
   */
  resetKey: string;
  /**
   * Platform-specific fetch wrapper. Should POST the body and return the raw
   * ReadableStream<Uint8Array> from the response. Receives an AbortSignal so
   * the underlying fetch is cancelled when the hook aborts.
   */
  fetchAnswerStream: (
    body: LearnerQuestionRequestBody,
    signal: AbortSignal,
  ) => Promise<ReadableStream<Uint8Array>>;
}

export interface UseLearnerQuestionResult {
  turns: LearnerQuestionTurn[];
  isStreaming: boolean;
  sendQuestion: (question: string) => Promise<void>;
  reset: () => void;
}

/** Generates a collision-resistant id for a turn. Uses a monotonic counter so
 * it works in both web (where crypto.randomUUID exists) and React Native / RN
 * Hermes environments where the global may not be typed by the tsconfig lib. */
let _turnCounter = 0;
const newTurnId = (): string => `turn-${Date.now()}-${++_turnCounter}`;

/**
 * Manages a per-phrase streaming Q&A thread backed by Claude (via the Next.js
 * /api/learner-question route).  All race-condition guards (sessionId,
 * AbortController, signal-checked state writes, StrictMode-safe cleanup) are
 * implemented as described in the plan.
 */
export const useLearnerQuestion = ({
  context,
  resetKey,
  fetchAnswerStream,
}: UseLearnerQuestionOptions): UseLearnerQuestionResult => {
  const [turns, setTurns] = useState<LearnerQuestionTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Refs that survive re-renders without re-running effects.
  const sessionIdRef = useRef(0);
  const inFlightAbortRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const contextRef = useRef(context);
  const fetchRef = useRef(fetchAnswerStream);
  // Kept in sync every render so sendQuestion can read turns without being in deps.
  const turnsRef = useRef(turns);

  // Keep refs current every render.
  contextRef.current = context;
  fetchRef.current = fetchAnswerStream;
  turnsRef.current = turns;

  isStreamingRef.current = isStreaming;

  // Reset thread when the phrase changes.
  useEffect(() => {
    sessionIdRef.current += 1;
    inFlightAbortRef.current?.abort();
    inFlightAbortRef.current = null;
    setTurns([]);
    setIsStreaming(false);
    isStreamingRef.current = false;
  }, [resetKey]);

  // Abort on unmount (StrictMode-safe: each mount gets a fresh sessionId).
  useEffect(() => {
    return () => {
      sessionIdRef.current += 1;
      inFlightAbortRef.current?.abort();
      inFlightAbortRef.current = null;
    };
  }, []);

  const reset = useCallback((): void => {
    sessionIdRef.current += 1;
    inFlightAbortRef.current?.abort();
    inFlightAbortRef.current = null;
    setTurns([]);
    setIsStreaming(false);
    isStreamingRef.current = false;
  }, []);

  const sendQuestion = useCallback(async (question: string): Promise<void> => {
    // Double-send guard — UI also disables Send while streaming, this is defensive.
    if (isStreamingRef.current) return;
    const trimmed = question.trim();
    if (trimmed === '') return;

    // Abort any previous in-flight stream (shouldn't be one, but be safe).
    inFlightAbortRef.current?.abort();

    const ac = new AbortController();
    inFlightAbortRef.current = ac;

    // Bump session and capture — used to guard all async state writes below.
    sessionIdRef.current += 1;
    const sessionId = sessionIdRef.current;

    // Snapshot context at request-start so the body is internally consistent
    // even if the parent re-renders mid-call. A resetKey change always aborts.
    const snapshotContext = contextRef.current;

    // Derive history from ref (avoids turns dep on sendQuestion).
    // Only include fully-completed, non-errored turns.
    const history = turnsRef.current
      .filter((t) => !t.isStreaming && t.error === null && t.answer.trim() !== '')
      .flatMap((t): Array<{ role: 'user' | 'assistant'; content: string }> => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: t.answer },
      ]);

    const turnId = newTurnId();
    const newTurn: LearnerQuestionTurn = {
      id: turnId,
      question: trimmed,
      answer: '',
      isStreaming: true,
      error: null,
    };

    setTurns((prev) => [...prev, newTurn]);
    setIsStreaming(true);
    isStreamingRef.current = true;

    const body: LearnerQuestionRequestBody = {
      ...snapshotContext,
      question: trimmed,
      history,
    };

    try {
      const stream = await fetchRef.current(body, ac.signal);

      // Guard after the await — resetKey may have changed during the fetch.
      if (ac.signal.aborted || sessionIdRef.current !== sessionId) return;

      const reader = stream.getReader();
      const decoder = new TextDecoder();

      while (true) {
        let done: boolean;
        let value: Uint8Array | undefined;

        try {
          ({ done, value } = await reader.read());
        } catch (readErr) {
          // AbortError is expected on phrase-change / unmount — swallow it.
          if ((readErr as Error).name === 'AbortError') return;
          throw readErr;
        }

        // Check guards before every state write.
        if (ac.signal.aborted || sessionIdRef.current !== sessionId) {
          reader.cancel().catch(() => undefined);
          return;
        }

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId ? { ...t, answer: t.answer + chunk } : t,
          ),
        );
      }

      // Flush any remaining bytes in the decoder buffer.
      const tail = decoder.decode();
      if (tail && !ac.signal.aborted && sessionIdRef.current === sessionId) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId ? { ...t, answer: t.answer + tail } : t,
          ),
        );
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (ac.signal.aborted || sessionIdRef.current !== sessionId) return;

      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? { ...t, isStreaming: false, error: message }
            : t,
        ),
      );
    } finally {
      // Only clear streaming state if this session is still current.
      if (sessionIdRef.current === sessionId && !ac.signal.aborted) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId && t.isStreaming ? { ...t, isStreaming: false } : t,
          ),
        );
        setIsStreaming(false);
        isStreamingRef.current = false;
        if (inFlightAbortRef.current === ac) {
          inFlightAbortRef.current = null;
        }
      }
    }
  // No external state in deps — all reads go through refs. Stable callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { turns, isStreaming, sendQuestion, reset };
};
