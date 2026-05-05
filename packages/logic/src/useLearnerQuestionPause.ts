'use client';

import { useEffect, useRef, useState } from 'react';

export interface UseLearnerQuestionPauseOptions {
  isCorrect: boolean;
  isExplainAckOpen: boolean;
  isAudioPlaying: boolean;
  onStopAnswerAudio: () => void;
  onExplainInterrupted?: () => void;
  /**
   * Changing this key fully resets pause state — use a value that changes when
   * the phrase or status changes (e.g. `${phrase.id}-${status}`).
   */
  resetKey: string;
}

export interface LearnerQuestionPauseHandle {
  isActive: boolean;
  /** Pill toggle: opens on first call, dismisses on second call. */
  toggle: () => void;
  /**
   * Closes the panel via the dismiss path (equivalent to the pill toggle-off
   * branch): fires `onExplainInterrupted` if audio was stopped, then clears
   * active state.
   */
  dismiss: () => void;
}

/**
 * Encapsulates the "I have a question" pause state shared between the pill
 * buttons inside `UserFeedback` / `UserRecording` and the `QuestionSidebar`.
 */
export function useLearnerQuestionPause({
  isCorrect,
  isExplainAckOpen,
  isAudioPlaying,
  onStopAnswerAudio,
  onExplainInterrupted,
  resetKey,
}: UseLearnerQuestionPauseOptions): LearnerQuestionPauseHandle {
  const [isActive, setIsActive] = useState(false);
  const audioWasInterrupted = useRef(false);
  const wasExplainAckOpenRef = useRef(false);
  const prevResetKeyRef = useRef(resetKey);

  // Hard-reset when the phrase/status changes via resetKey.
  useEffect(() => {
    if (prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey;
      setIsActive(false);
      audioWasInterrupted.current = false;
    }
  }, [resetKey]);

  // Reset when the phrase is no longer correct (e.g. Try Again).
  useEffect(() => {
    if (!isCorrect) {
      setIsActive(false);
      audioWasInterrupted.current = false;
    }
  }, [isCorrect]);

  // Reset when explain-ack closes.
  useEffect(() => {
    if (wasExplainAckOpenRef.current && !isExplainAckOpen) {
      setIsActive(false);
      audioWasInterrupted.current = false;
    }
    wasExplainAckOpenRef.current = isExplainAckOpen;
  }, [isExplainAckOpen]);

  const dismiss = (): void => {
    if (audioWasInterrupted.current) {
      onExplainInterrupted?.();
      audioWasInterrupted.current = false;
    }
    setIsActive(false);
  };

  const toggle = (): void => {
    if (!isActive) {
      if (isAudioPlaying) {
        onStopAnswerAudio();
        audioWasInterrupted.current = true;
      }
      setIsActive(true);
    } else {
      dismiss();
    }
  };

  return { isActive, toggle, dismiss };
}
