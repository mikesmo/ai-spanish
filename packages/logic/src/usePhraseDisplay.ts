'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { normalizeStr } from './comparison';
import { POST_SUCCESS_EXTRA_PAUSE_MS, WRONG_ANSWER_PAUSE_MS } from './phraseDisplayTiming';
import type { Phrase, UIStatus, TTSAdapter, SpeechToTextHandle, PhraseDisplayAPI } from './types';

const PLAYBACK_RATES: Record<'1x' | 'slow', number> = { '1x': 1.0, slow: 0.5 };

const noopSuccessChime = async (_signal: AbortSignal): Promise<void> => {};

export type UsePhraseDisplayOptions = {
  /** Web: play a short success sound; must resolve when finished or reject on abort. */
  playSuccessChime?: (signal: AbortSignal) => Promise<void>;
};

// UI flows through these states in order:
//
//   loading → idle → recording → answer
//               ↑                   ↓ (Try Again)
//            tryAgain ←←←←←←←←←←←←←
export function usePhraseDisplay(
  phrases: Phrase[],
  stt: SpeechToTextHandle,
  tts: TTSAdapter,
  options?: UsePhraseDisplayOptions,
): PhraseDisplayAPI {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<UIStatus>('loading');
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [speed, setSpeed] = useState<'1x' | 'slow'>('1x');

  const playSuccessChime = options?.playSuccessChime ?? noopSuccessChime;
  const playSuccessChimeRef = useRef(playSuccessChime);
  playSuccessChimeRef.current = playSuccessChime;

  const sttRef = useRef(stt);
  const ttsRef = useRef(tts);
  sttRef.current = stt;
  ttsRef.current = tts;

  const currentPhrase = phrases[currentIndex];
  const englishText = currentPhrase.English.intro
    ? `${currentPhrase.English.intro}: ${currentPhrase.English.question}`
    : currentPhrase.English.question;
  const spanishText = currentPhrase.Spanish.answer;
  const caption = stt.caption;

  const isCorrect =
    !!caption?.trim() && normalizeStr(caption) === normalizeStr(spanishText);

  const handleShowAnswer = useCallback(async () => {
    sttRef.current.stop();
    setStatus('answer');
    try {
      setIsAudioPlaying(true);
      await ttsRef.current.play(spanishText, 'es', undefined, currentIndex);
    } catch (error) {
      console.error('[usePhraseDisplay] Error playing Spanish:', error);
    } finally {
      setIsAudioPlaying(false);
    }
  }, [spanishText, currentIndex]);

  // On phrase change: prefetch both audios, play English prompt, then auto-start recording.
  useEffect(() => {
    setStatus('loading');
    setIsAudioPlaying(false);
    let cancelled = false;

    const init = async () => {
      try {
        await Promise.all([
          ttsRef.current.prefetch(englishText, 'en', currentIndex),
          ttsRef.current.prefetch(spanishText, 'es', currentIndex),
        ]);
        if (cancelled) return;
        setStatus('idle');
        setIsAudioPlaying(true);
        await ttsRef.current.play(englishText, 'en', undefined, currentIndex);
        if (cancelled) return;
        sttRef.current.clearTranscription();
        sttRef.current.start();
      } catch (error) {
        if (!cancelled) {
          console.error('[usePhraseDisplay] Error loading phrase audio:', error);
          setStatus('idle');
        }
      } finally {
        if (!cancelled) setIsAudioPlaying(false);
      }
    };

    void init();

    return () => {
      cancelled = true;
      ttsRef.current.stop();
    };
  }, [currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transition to recording once the mic opens.
  useEffect(() => {
    if (stt.isRecording) {
      setStatus('recording');
    }
  }, [stt.isRecording]);

  // Correct: chime, then pause, then Spanish answer.
  useEffect(() => {
    if (!isCorrect || (status !== 'recording' && status !== 'tryAgain')) {
      return;
    }

    const ac = new AbortController();
    let postSoundTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      await Promise.resolve(sttRef.current.stop());
      if (ac.signal.aborted) return;
      try {
        await playSuccessChimeRef.current(ac.signal);
      } catch {
        if (ac.signal.aborted) return;
      }
      if (ac.signal.aborted) return;

      postSoundTimer = setTimeout(() => {
        postSoundTimer = null;
        if (!ac.signal.aborted) void handleShowAnswer();
      }, POST_SUCCESS_EXTRA_PAUSE_MS);
    })();

    return () => {
      ac.abort();
      if (postSoundTimer !== null) clearTimeout(postSoundTimer);
    };
  }, [isCorrect, status, currentIndex, handleShowAnswer]);

  // Final wrong transcript: pause, then Spanish answer.
  useEffect(() => {
    if (!stt.isFinal || isCorrect || (status !== 'recording' && status !== 'tryAgain')) {
      return;
    }

    const t = setTimeout(() => {
      void handleShowAnswer();
    }, WRONG_ANSWER_PAUSE_MS);

    return () => clearTimeout(t);
  }, [stt.isFinal, isCorrect, status, currentIndex, handleShowAnswer]);

  const handleTryAgain = () => {
    ttsRef.current.stop();
    sttRef.current.clearTranscription();
    setStatus('tryAgain');
    sttRef.current.start();
  };

  const handleNext = () => {
    sttRef.current.clearTranscription();
    setCurrentIndex((i) => (i + 1) % phrases.length);
  };

  const handleReplay = async () => {
    try {
      setIsAudioPlaying(true);
      await ttsRef.current.play(spanishText, 'es', PLAYBACK_RATES[speed], currentIndex);
    } catch (error) {
      console.error('[usePhraseDisplay] Error replaying Spanish:', error);
    } finally {
      setIsAudioPlaying(false);
    }
  };

  return {
    status,
    currentIndex,
    totalPhrases: phrases.length,
    currentPhrase,
    englishText,
    spanishText,
    caption,
    isCorrect,
    isAudioPlaying,
    speed,
    setSpeed,
    handleShowAnswer,
    handleTryAgain,
    handleNext,
    handleReplay,
  };
}
