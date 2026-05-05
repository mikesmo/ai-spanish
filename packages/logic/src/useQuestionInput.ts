'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechToTextHandle } from './types';

export const DEFAULT_QUESTION_MAX_RECORD_MS = 30_000;

export interface UseQuestionInputOptions {
  maxRecordMs?: number;
}

export interface UseQuestionInputResult {
  text: string;
  setText: (value: string) => void;
  isRecording: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  error: string | null;
}

const appendTranscript = (baseText: string, transcript: string): string => {
  const normalizedTranscript = transcript.trim();
  if (normalizedTranscript === '') {
    return baseText;
  }
  if (baseText.trim() === '') {
    return normalizedTranscript;
  }
  return `${baseText.trimEnd()} ${normalizedTranscript}`;
};

/**
 * Manages learner-question dictation while keeping committed text separate
 * from the active STT session's live transcript.
 */
export const useQuestionInput = (
  stt: SpeechToTextHandle,
  options: UseQuestionInputOptions = {},
): UseQuestionInputResult => {
  const maxRecordMs = options.maxRecordMs ?? DEFAULT_QUESTION_MAX_RECORD_MS;
  const [baseText, setBaseTextState] = useState('');
  const [isRecording, setIsRecording] = useState(false);

  const sttRef = useRef(stt);
  const baseTextRef = useRef(baseText);
  const activeBaseTextRef = useRef(baseText);
  const sttCaptionRef = useRef(stt.caption);
  const isRecordingRef = useRef(isRecording);
  const sessionIdRef = useRef(0);
  const sessionAbortRef = useRef<AbortController | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopInFlightRef = useRef<Promise<void> | null>(null);

  sttRef.current = stt;
  baseTextRef.current = baseText;
  sttCaptionRef.current = stt.caption;
  isRecordingRef.current = isRecording;

  const clearMaxDurationTimer = useCallback((): void => {
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  }, []);

  const setCommittedText = useCallback((nextText: string): void => {
    baseTextRef.current = nextText;
    setBaseTextState(nextText);
  }, []);

  const commitActiveCaption = useCallback((): string => {
    const nextText = appendTranscript(
      activeBaseTextRef.current,
      sttCaptionRef.current,
    );
    setCommittedText(nextText);
    return nextText;
  }, [setCommittedText]);

  const stopRecording = useCallback((): void => {
    if (!isRecordingRef.current && !sessionAbortRef.current) {
      return;
    }

    const sessionId = sessionIdRef.current;
    isRecordingRef.current = false;
    setIsRecording(false);
    clearMaxDurationTimer();
    sessionAbortRef.current?.abort();
    sessionAbortRef.current = null;
    commitActiveCaption();

    const stopPromise = Promise.resolve(sttRef.current.stop()).finally(() => {
      if (stopInFlightRef.current === stopPromise) {
        stopInFlightRef.current = null;
      }
      if (sessionIdRef.current !== sessionId) {
        return;
      }
      commitActiveCaption();
    });
    stopInFlightRef.current = stopPromise;
    void stopPromise;
  }, [clearMaxDurationTimer, commitActiveCaption]);

  const startRecording = useCallback((): void => {
    if (isRecordingRef.current || sessionAbortRef.current) {
      return;
    }

    sessionIdRef.current += 1;
    const sessionId = sessionIdRef.current;
    const abortController = new AbortController();
    sessionAbortRef.current = abortController;
    activeBaseTextRef.current = baseTextRef.current;
    sttCaptionRef.current = '';
    clearMaxDurationTimer();
    sttRef.current.clearTranscription();
    isRecordingRef.current = true;
    setIsRecording(true);

    void (async () => {
      const pendingStop = stopInFlightRef.current;
      if (pendingStop) {
        await pendingStop.catch(() => undefined);
      }
      if (
        sessionIdRef.current !== sessionId ||
        abortController.signal.aborted
      ) {
        return;
      }
      sttRef.current.clearTranscription();
      sttRef.current.start({ signal: abortController.signal });
      maxDurationTimerRef.current = setTimeout(() => {
        stopRecording();
      }, maxRecordMs);
    })();
  }, [clearMaxDurationTimer, maxRecordMs, stopRecording]);

  const setText = useCallback((value: string): void => {
    setCommittedText(value);
    activeBaseTextRef.current = value;
  }, [setCommittedText]);

  useEffect(() => {
    return () => {
      sessionIdRef.current += 1;
      isRecordingRef.current = false;
      clearMaxDurationTimer();
      sessionAbortRef.current?.abort();
      sessionAbortRef.current = null;
      void Promise.resolve(sttRef.current.stop());
    };
  }, [clearMaxDurationTimer]);

  return {
    text: isRecording
      ? appendTranscript(activeBaseTextRef.current, stt.caption)
      : baseText,
    setText,
    isRecording,
    startRecording,
    stopRecording,
    error: stt.error,
  };
};
