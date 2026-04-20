'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { alignWords } from './alignment';
import {
  ACCURACY_SUCCESS_THRESHOLD,
  computeAccuracy,
  isAccuracySuccess as isAccuracyThresholdReached,
} from './accuracy';
import { normalizeStr } from './comparison';
import { computeFluency } from './fluency';
import {
  getDefaultLearningPipelineDebug,
  logLearningAttempt,
  logLearningPractice,
  logRevealEmitted,
  logRevealSkipped,
} from './learningPipelineDebug';
import { computeMastery } from './mastery';
import { POST_SUCCESS_EXTRA_PAUSE_MS, WRONG_ANSWER_PAUSE_MS } from './phraseDisplayTiming';
import type {
  Attempt,
  PhraseEvent,
  PracticeAttempt,
  RevealEvent,
} from './events';
import type {
  Phrase,
  PhraseDisplayAPI,
  ScoreBreakdown,
  SpeechToTextHandle,
  SpokenWord,
  TTSAdapter,
  UIStatus,
} from './types';

const PLAYBACK_RATES: Record<'1x' | 'slow', number> = { '1x': 1.0, slow: 0.5 };

const noopSuccessChime = async (_signal: AbortSignal): Promise<void> => {};

export type UsePhraseDisplayOptions = {
  /** Web: play a short success sound; must resolve when finished or reject on abort. */
  playSuccessChime?: (signal: AbortSignal) => Promise<void>;
  /**
   * Called once per attempt / practice-attempt / reveal. Host apps wire this
   * up to a ProgressStore + SessionEngine to drive mastery and SRS.
   */
  onPhraseEvent?: (event: PhraseEvent) => void;
  /**
   * Log alignment → accuracy → fluency (and reveal/practice) to the console.
   * Defaults to `true` in development (`NODE_ENV === 'development'` or `__DEV__`).
   */
  debugLearningPipeline?: boolean;
};

const splitWords = (s: string): string[] =>
  s.trim().split(/\s+/).filter(Boolean);

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
  const [lastScoreBreakdown, setLastScoreBreakdown] =
    useState<ScoreBreakdown | null>(null);

  const playSuccessChime = options?.playSuccessChime ?? noopSuccessChime;
  const playSuccessChimeRef = useRef(playSuccessChime);
  playSuccessChimeRef.current = playSuccessChime;

  const onPhraseEventRef = useRef(options?.onPhraseEvent);
  onPhraseEventRef.current = options?.onPhraseEvent;

  const debugLearningPipelineRef = useRef(
    options?.debugLearningPipeline ?? getDefaultLearningPipelineDebug(),
  );
  debugLearningPipelineRef.current =
    options?.debugLearningPipeline ?? getDefaultLearningPipelineDebug();

  const sttRef = useRef(stt);
  const ttsRef = useRef(tts);
  sttRef.current = stt;
  ttsRef.current = tts;

  /** Tracks whether an Attempt/PracticeAttempt event has already been emitted for the
   * current phrase presentation. Used to suppress duplicate events and to
   * classify a Show-Answer click as Reveal vs. no-op. */
  const attemptEmittedRef = useRef(false);
  const statusRef = useRef<UIStatus>(status);
  statusRef.current = status;

  const currentPhrase = phrases[currentIndex]!;
  const englishText = currentPhrase.English.intro
    ? `${currentPhrase.English.intro}: ${currentPhrase.English.question}`
    : currentPhrase.English.question;
  const spanishText = currentPhrase.Spanish.answer;
  const caption = stt.caption;
  const sttWords: SpokenWord[] = stt.words;

  const isCorrect =
    !!caption?.trim() && normalizeStr(caption) === normalizeStr(spanishText);

  const emitAttempt = useCallback(
    (finalCaption: string, words: SpokenWord[], now: number) => {
      const target = currentPhrase.Spanish.words;
      const alignment = alignWords(target, words);
      const accuracy = computeAccuracy(target, alignment);
      const fluency = computeFluency(words);
      const fluencyScore = fluency?.fluencyScore ?? null;
      const accuracySucceeded = isAccuracyThresholdReached(accuracy.accuracy);
      const uiSuccess =
        !!finalCaption.trim() &&
        normalizeStr(finalCaption) === normalizeStr(spanishText);
      const mastery = computeMastery(
        accuracy.accuracy,
        fluencyScore,
        // Stability update happens inside the reducer; we surface the pure
        // mastery of *this* attempt alone for UI, using the prior stability
        // the host may or may not have. Keep it simple: use 0 for UI preview.
        0,
      );

      setLastScoreBreakdown({
        accuracy: accuracy.accuracy,
        fluency: fluencyScore,
        mastery,
        isAccuracySuccess: accuracySucceeded,
      });

      const attempt: Attempt = {
        eventType: 'attempt',
        phraseId: currentPhrase.id,
        transcript: splitWords(finalCaption),
        missingWords: alignment.missing.map((w) => w.word),
        extraWords: alignment.extra.map((w) => w.word),
        accuracyScore: accuracy.accuracy,
        fluencyScore,
        isAccuracySuccess: accuracySucceeded,
        success: uiSuccess,
        timestamp: now,
      };

      attemptEmittedRef.current = true;
      if (debugLearningPipelineRef.current) {
        logLearningAttempt({
          phraseId: currentPhrase.id,
          spanishTarget: spanishText,
          transcript: finalCaption,
          spokenWords: words,
          alignment,
          accuracy,
          fluency,
          uiExactMatch: uiSuccess,
          accuracySuccess: accuracySucceeded,
          masteryPreview: mastery,
        });
      }
      onPhraseEventRef.current?.(attempt);
    },
    [currentPhrase, spanishText],
  );

  const emitPracticeAttempt = useCallback(
    (finalCaption: string, words: SpokenWord[], now: number) => {
      const fluency = computeFluency(words);
      if (debugLearningPipelineRef.current) {
        const target = currentPhrase.Spanish.words;
        const alignment = alignWords(target, words);
        const accuracy = computeAccuracy(target, alignment);
        logLearningPractice({
          phraseId: currentPhrase.id,
          spanishTarget: spanishText,
          transcript: finalCaption,
          spokenWords: words,
          alignment,
          accuracy,
          fluency,
        });
      }
      const practice: PracticeAttempt = {
        eventType: 'practice',
        phraseId: currentPhrase.id,
        transcript: splitWords(finalCaption),
        fluencyScore: fluency?.fluencyScore ?? null,
        timestamp: now,
      };
      attemptEmittedRef.current = true;
      onPhraseEventRef.current?.(practice);
    },
    [currentPhrase, spanishText],
  );

  const emitReveal = useCallback((now: number) => {
    if (debugLearningPipelineRef.current) {
      logRevealEmitted(currentPhrase.id);
    }
    const reveal: RevealEvent = {
      eventType: 'reveal',
      phraseId: currentPhrase.id,
      penaltyApplied: true,
      timestamp: now,
    };
    onPhraseEventRef.current?.(reveal);
  }, [currentPhrase]);

  /** Plays the Spanish answer audio and transitions to the `answer` status.
   * Used both for auto-advance after an attempt and for user-initiated reveal. */
  const playAnswerAudio = useCallback(async () => {
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

  /** User explicitly clicked "Show Answer". Emits a Reveal event if no attempt
   * has already been emitted for this phrase presentation. */
  const handleShowAnswer = useCallback(async () => {
    if (!attemptEmittedRef.current) {
      emitReveal(Date.now());
    } else if (debugLearningPipelineRef.current) {
      logRevealSkipped(currentPhrase.id);
    }
    await playAnswerAudio();
  }, [currentPhrase.id, emitReveal, playAnswerAudio]);

  // On phrase change: prefetch both audios, play English prompt, then auto-start recording.
  useEffect(() => {
    setStatus('loading');
    setIsAudioPlaying(false);
    setLastScoreBreakdown(null);
    attemptEmittedRef.current = false;
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

  // Correct: chime, then pause, then Spanish answer. Attempt/PracticeAttempt
  // event is emitted before the answer plays.
  useEffect(() => {
    if (!isCorrect || (status !== 'recording' && status !== 'tryAgain')) {
      return;
    }

    const ac = new AbortController();
    let postSoundTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      await Promise.resolve(sttRef.current.stop());
      if (ac.signal.aborted) return;

      // Emit the learning event as soon as the utterance lands.
      const captureNow = Date.now();
      const captureCaption = sttRef.current.caption;
      const captureWords = sttRef.current.words;
      if (!attemptEmittedRef.current) {
        if (statusRef.current === 'tryAgain') {
          emitPracticeAttempt(captureCaption, captureWords, captureNow);
        } else {
          emitAttempt(captureCaption, captureWords, captureNow);
        }
      }

      try {
        await playSuccessChimeRef.current(ac.signal);
      } catch {
        if (ac.signal.aborted) return;
      }
      if (ac.signal.aborted) return;

      postSoundTimer = setTimeout(() => {
        postSoundTimer = null;
        if (!ac.signal.aborted) void playAnswerAudio();
      }, POST_SUCCESS_EXTRA_PAUSE_MS);
    })();

    return () => {
      ac.abort();
      if (postSoundTimer !== null) clearTimeout(postSoundTimer);
    };
  }, [isCorrect, status, currentIndex, playAnswerAudio, emitAttempt, emitPracticeAttempt]);

  // Final wrong transcript: emit the attempt (or practice), pause, then play Spanish.
  useEffect(() => {
    if (!stt.isFinal || isCorrect || (status !== 'recording' && status !== 'tryAgain')) {
      return;
    }

    if (!attemptEmittedRef.current) {
      const now = Date.now();
      if (status === 'tryAgain') {
        emitPracticeAttempt(stt.caption, stt.words, now);
      } else {
        emitAttempt(stt.caption, stt.words, now);
      }
    }

    const t = setTimeout(() => {
      void playAnswerAudio();
    }, WRONG_ANSWER_PAUSE_MS);

    return () => clearTimeout(t);
  }, [
    stt.isFinal,
    stt.caption,
    stt.words,
    isCorrect,
    status,
    currentIndex,
    playAnswerAudio,
    emitAttempt,
    emitPracticeAttempt,
  ]);

  const handleTryAgain = () => {
    ttsRef.current.stop();
    sttRef.current.clearTranscription();
    // Try Again starts a new practice session for this phrase — we do NOT
    // clear attemptEmittedRef because any event emitted in the tryAgain state
    // is a PracticeAttempt; we still want to avoid double-emitting within a
    // single tryAgain pass. Reset specifically the "has emitted for this
    // recording pass" bit.
    attemptEmittedRef.current = false;
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
    lastScoreBreakdown,
  };
}

export { ACCURACY_SUCCESS_THRESHOLD };
