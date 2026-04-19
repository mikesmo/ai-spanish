'use client';

import { useState, useEffect } from 'react';
import { normalizeStr } from './comparison';
import type { Phrase, UIStatus, TTSAdapter, SpeechToTextHandle, PhraseDisplayAPI } from './types';

// #region agent log
// Hypothesis A/B: detect whether this module is evaluated in a server (non-browser) context
if (typeof window === 'undefined') {
  fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'b089b2' },
    body: JSON.stringify({ sessionId: 'b089b2', hypothesisId: 'A-B-post-fix', location: 'usePhraseDisplay.ts:module-scope', message: 'POST-FIX: usePhraseDisplay still evaluated in SERVER context', data: {}, timestamp: Date.now() }),
  }).catch(() => {});
}
// #endregion

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
      // #region agent log
      // Hypothesis A: log what text is being displayed at each index
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b089b2'},body:JSON.stringify({sessionId:'b089b2',hypothesisId:'A',location:'usePhraseDisplay.ts:init',message:'phrase display state',data:{currentIndex,englishText,spanishText},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      try {
        await Promise.all([
          tts.prefetch(englishText, 'en', currentIndex),
          tts.prefetch(spanishText, 'es', currentIndex),
        ]);
        if (cancelled) return;
        setStatus('idle');
        setIsAudioPlaying(true);
        await tts.play(englishText, 'en', undefined, currentIndex);
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
      await tts.play(spanishText, 'es', undefined, currentIndex);
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
      await tts.play(spanishText, 'es', PLAYBACK_RATES[speed], currentIndex);
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
