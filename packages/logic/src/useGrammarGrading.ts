'use client';

import { useCallback, useRef } from 'react';
import {
  getDefaultLearningPipelineDebug,
  logGrammarGradingStarted,
  logGrammarGradingResult,
  logGrammarGradingFailure,
} from './learningPipelineDebug';
import type { GrammarGradingRequest, GrammarGradingResult } from './grammarGrading';
import { buildGrammarGradingPrompts } from './grammarGradingPrompt';

/** Platform-specific POST implementation. Web uses fetch('/api/grammar-grading'). */
export type PostGrammarGrading = (
  request: GrammarGradingRequest,
) => Promise<GrammarGradingResult>;

export interface UseGrammarGradingOptions {
  /** Platform-specific HTTP transport — POST the request and return the result JSON. */
  post: PostGrammarGrading;
  /** Called when AI grading succeeds. */
  onResult: (eventSeq: number, result: GrammarGradingResult) => void;
  /** Called when AI grading fails or times out. Caller should apply fallback. */
  onFailure: (eventSeq: number, error: unknown) => void;
}

export interface UseGrammarGradingResult {
  /**
   * Fire-and-forget: POSTs the grading request and calls `onResult` or
   * `onFailure` when it settles. Never blocks the lesson flow.
   */
  kickoff: (request: GrammarGradingRequest) => void;
  /** Number of in-flight grading requests. */
  pendingCount: number;
}

/** Timeout for each grading request before the fallback is used (12 seconds). */
const GRADING_TIMEOUT_MS = 12_000;

/**
 * Shared hook that manages fire-and-forget AI grammar grading requests.
 * One instance per lesson session, composed inside `useLessonSessionWithHistory`.
 * The `post` implementation is platform-specific; inject it from the host.
 */
export const useGrammarGrading = ({
  post,
  onResult,
  onFailure,
}: UseGrammarGradingOptions): UseGrammarGradingResult => {
  const inFlightRef = useRef(new Map<number, AbortController>());
  const pendingCountRef = useRef(0);

  const postRef = useRef(post);
  const onResultRef = useRef(onResult);
  const onFailureRef = useRef(onFailure);

  postRef.current = post;
  onResultRef.current = onResult;
  onFailureRef.current = onFailure;

  const kickoff = useCallback((request: GrammarGradingRequest): void => {
    const { eventSeq } = request;
    const startedAtMs = Date.now();

    const ac = new AbortController();
    inFlightRef.current.set(eventSeq, ac);
    pendingCountRef.current += 1;

    const { systemPrompt, userPrompt } = buildGrammarGradingPrompts(request);

    if (getDefaultLearningPipelineDebug()) {
      logGrammarGradingStarted({ request, systemPrompt, userPrompt });
    }

    const timeoutId = setTimeout(() => {
      ac.abort(new Error('Grammar grading timeout'));
    }, GRADING_TIMEOUT_MS);

    void (async () => {
      try {
        const result = await postRef.current(request);

        if (ac.signal.aborted) return;

        const latencyMs = Date.now() - startedAtMs;
        if (getDefaultLearningPipelineDebug()) {
          logGrammarGradingResult({ eventSeq, phraseId: request.phraseId, result, latencyMs });
        }

        onResultRef.current(eventSeq, result);
      } catch (err) {
        if (ac.signal.aborted && (err as Error)?.name === 'AbortError') {
          const timeoutErr = new Error(
            `Grammar grading timed out after ${GRADING_TIMEOUT_MS}ms`,
          );
          const latencyMs = Date.now() - startedAtMs;
          if (getDefaultLearningPipelineDebug()) {
            logGrammarGradingFailure({
              eventSeq,
              phraseId: request.phraseId,
              error: timeoutErr,
              request,
              latencyMs,
            });
          }
          onFailureRef.current(eventSeq, timeoutErr);
          return;
        }

        const latencyMs = Date.now() - startedAtMs;
        if (getDefaultLearningPipelineDebug()) {
          logGrammarGradingFailure({ eventSeq, phraseId: request.phraseId, error: err, request, latencyMs });
        }
        onFailureRef.current(eventSeq, err);
      } finally {
        clearTimeout(timeoutId);
        inFlightRef.current.delete(eventSeq);
        pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
      }
    })();
  }, []);

  return {
    kickoff,
    get pendingCount() {
      return pendingCountRef.current;
    },
  };
};
