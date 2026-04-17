import { useState, useEffect } from 'react';
import { normalizeStr } from './comparison';
import type { Phrase, UIStatus, TTSAdapter, SpeechToTextHandle, PhraseDisplayAPI } from './types';

const PLAYBACK_RATES: Record<'1x' | 'slow', number> = { '1x': 1.0, slow: 0.5 };

// UI flows through these states in order:
//
//   loading → idle → recording → answer
//               ↑                   ↓ (Try Again)
//            tryAgain ←←←←←←←←←←←←←
export function usePhraseDisplay(
  phrases: Phrase[],
  stt: SpeechToTextHandle,
  tts: TTSAdapter
): PhraseDisplayAPI {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<UIStatus>('loading');
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [speed, setSpeed] = useState<'1x' | 'slow'>('1x');

  const currentPhrase = phrases[currentIndex];
  const englishText = currentPhrase.English.intro
    ? `${currentPhrase.English.intro}: ${currentPhrase.English.question}`
    : currentPhrase.English.question;
  const spanishText = currentPhrase.Spanish.question;
  const caption = stt.caption;

  const isCorrect =
    !!caption?.trim() && normalizeStr(caption) === normalizeStr(spanishText);

  // On phrase change: prefetch both audios, play English prompt, then auto-start recording.
  useEffect(() => {
    setStatus('loading');
    setIsAudioPlaying(false);
    let cancelled = false;

    const init = async () => {
      try {
        await Promise.all([
          tts.prefetch(englishText, 'en'),
          tts.prefetch(spanishText, 'es'),
        ]);
        if (cancelled) return;
        setStatus('idle');
        setIsAudioPlaying(true);
        await tts.play(englishText, 'en');
        if (cancelled) return;
        stt.clearTranscription();
        stt.start();
      } catch (error) {
        if (!cancelled) {
          console.error('[usePhraseDisplay] Error loading phrase audio:', error);
          setStatus('idle');
        }
      } finally {
        if (!cancelled) setIsAudioPlaying(false);
      }
    };

    init();

    return () => {
      cancelled = true;
      tts.stop();
    };
  }, [currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transition to recording once the mic opens.
  useEffect(() => {
    if (stt.isRecording) {
      setStatus('recording');
    }
  }, [stt.isRecording]);

  const handleShowAnswer = async () => {
    stt.stop();
    setStatus('answer');
    try {
      setIsAudioPlaying(true);
      await tts.play(spanishText, 'es');
    } catch (error) {
      console.error('[usePhraseDisplay] Error playing Spanish:', error);
    } finally {
      setIsAudioPlaying(false);
    }
  };

  // Stop as soon as the transcript matches — even on an interim result.
  useEffect(() => {
    if (isCorrect && (status === 'recording' || status === 'tryAgain')) {
      stt.stop();
      setTimeout(() => handleShowAnswer(), 2000);
    }
  }, [isCorrect]); // eslint-disable-line react-hooks/exhaustive-deps

  // When Deepgram marks a final transcript and it's wrong, advance to feedback.
  useEffect(() => {
    if (stt.isFinal && !isCorrect && (status === 'recording' || status === 'tryAgain')) {
      setTimeout(() => handleShowAnswer(), 2000);
    }
  }, [stt.isFinal]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTryAgain = () => {
    tts.stop();
    stt.clearTranscription();
    setStatus('tryAgain');
    stt.start();
  };

  const handleNext = () => {
    stt.clearTranscription();
    setCurrentIndex((i) => (i + 1) % phrases.length);
  };

  const handleReplay = async () => {
    try {
      setIsAudioPlaying(true);
      await tts.play(spanishText, 'es', PLAYBACK_RATES[speed]);
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
