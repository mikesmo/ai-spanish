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
  logAttemptFireSource,
  logLearningAttempt,
  logLearningPractice,
  logPhraseBoundary,
  logRevealEmitted,
  logRevealSkipped,
} from './learningPipelineDebug';
import { computeMastery } from './mastery';
import { POST_SUCCESS_EXTRA_PAUSE_MS } from './phraseDisplayTiming';
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
   * Called once at the start of each new phrase presentation (not on Try
   * Again). Host apps use this to track per-phrase visit counts, e.g. to
   * flag repeated presentations in session history.
   */
  onPresentationStart?: (phrase: Phrase) => void;
  /**
   * Optional monotonic counter incremented by the host on every navigation
   * (e.g. session engine `pickNext`) so the phrase-bootstrap effect re-runs
   * even when the same phrase id is re-presented at the same index. In
   * linear lessons where navigation is driven solely by `currentIndex`,
   * leave this undefined and the effect will behave as before.
   */
  presentationVersion?: number;
  /**
   * Overrides the numeric index passed to the TTS adapter (`phraseIndex`
   * argument of `play` / `prefetch`). Required when the `phrases` prop is a
   * queue-driven 1-element array: the local `currentIndex` would always be
   * `0` and the S3 adapter would keep replaying the first phrase's clips.
   * Hosts should pass the current phrase's position in the original deck.
   * When omitted, `currentIndex` is used (linear navigation).
   */
  ttsPhraseIndex?: number;
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

  /**
   * S3 phrase-index hint passed to the TTS adapter. Falls back to
   * `currentIndex` when the host does not override — preserves
   * linear-navigation behavior. Required for queue-driven hosts where the
   * `phrases` prop is a 1-element array (see `UsePhraseDisplayOptions.ttsPhraseIndex`).
   * Kept in a ref so async flows (playAnswerAudio, handleReplay, bootstrap
   * init) always read the freshest value without forcing extra dep-array
   * entries.
   */
  const ttsPhraseIndex = options?.ttsPhraseIndex ?? currentIndex;
  const ttsPhraseIndexRef = useRef<number>(ttsPhraseIndex);
  ttsPhraseIndexRef.current = ttsPhraseIndex;

  const playSuccessChime = options?.playSuccessChime ?? noopSuccessChime;
  const playSuccessChimeRef = useRef(playSuccessChime);
  playSuccessChimeRef.current = playSuccessChime;

  const onPhraseEventRef = useRef(options?.onPhraseEvent);
  onPhraseEventRef.current = options?.onPhraseEvent;

  const onPresentationStartRef = useRef(options?.onPresentationStart);
  onPresentationStartRef.current = options?.onPresentationStart;

  const presentationVersion = options?.presentationVersion;

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

  /** Timestamp (ms since epoch) of the first is_final=true for the current
   * phrase presentation. Used as an observability metric in
   * `logAttemptFireSource` — shows how much time elapsed between Deepgram's
   * first finalized segment and the moment we actually emit the Attempt
   * (≈0 ms for speech-final, success-chime duration for success-path-timer). */
  const firstIsFinalAtRef = useRef<number | null>(null);
  const prevIndexRef = useRef<number | null>(null);
  /**
   * Suppress duplicate `onPresentationStart` when React Strict Mode (or any
   * identical-deps re-run) invokes the phrase bootstrap effect twice for the
   * same logical card. Key: index|phraseId|presentationVersion.
   */
  const lastPresentationNotifyKeyRef = useRef<string | null>(null);

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
    (
      finalCaption: string,
      words: SpokenWord[],
      now: number,
      meta: {
        trigger: 'speech-final' | 'success-path-timer' | 'manual';
        isFinalAtCapture: boolean;
        msSinceFirstFinal: number | null;
      },
    ) => {
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
          targetWords: target,
          transcript: finalCaption,
          spokenWords: words,
          alignment,
          accuracy,
          fluency,
          uiExactMatch: uiSuccess,
          accuracySuccess: accuracySucceeded,
          masteryPreview: mastery,
          isFinalAtCapture: meta.isFinalAtCapture,
          msSinceFirstFinal: meta.msSinceFirstFinal,
          trigger: meta.trigger,
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
    // Mark an event as emitted so the speech-final emit effect (if it fires
    // after this reveal) short-circuits instead of double-emitting an Attempt.
    attemptEmittedRef.current = true;
    onPhraseEventRef.current?.(reveal);
  }, [currentPhrase]);

  /** Plays the Spanish answer audio and transitions to the `answer` status.
   * Used both for auto-advance after an attempt and for user-initiated reveal. */
  const playAnswerAudio = useCallback(async () => {
    sttRef.current.stop();
    setStatus('answer');
    try {
      setIsAudioPlaying(true);
      await ttsRef.current.play(
        spanishText,
        'es',
        undefined,
        ttsPhraseIndexRef.current,
      );
    } catch (error) {
      console.error('[usePhraseDisplay] Error playing Spanish:', error);
    } finally {
      setIsAudioPlaying(false);
    }
  }, [spanishText]);

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
    firstIsFinalAtRef.current = null;
    if (debugLearningPipelineRef.current) {
      logPhraseBoundary({
        fromIndex: prevIndexRef.current,
        toIndex: currentIndex,
        phraseId: currentPhrase.id,
        reason: prevIndexRef.current === null ? 'init' : 'next',
      });
    }
    prevIndexRef.current = currentIndex;
    const notifyKey = `${currentIndex}|${currentPhrase.id}|${presentationVersion ?? ''}`;
    const shouldNotifyPresentation =
      lastPresentationNotifyKeyRef.current !== notifyKey;
    if (shouldNotifyPresentation) {
      lastPresentationNotifyKeyRef.current = notifyKey;
      onPresentationStartRef.current?.(currentPhrase);
    }
    let cancelled = false;

    const init = async () => {
      try {
        const hintedIndex = ttsPhraseIndexRef.current;
        await Promise.all([
          ttsRef.current.prefetch(englishText, 'en', hintedIndex),
          ttsRef.current.prefetch(spanishText, 'es', hintedIndex),
        ]);
        if (cancelled) return;
        setStatus('idle');
        setIsAudioPlaying(true);
        await ttsRef.current.play(
          englishText,
          'en',
          undefined,
          ttsPhraseIndexRef.current,
        );
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
    // Re-run on currentIndex change (linear navigation) AND on
    // presentationVersion bumps from a session engine so a requeued phrase
    // at the same index (or a one-element `phrases` array) still triggers a
    // fresh bootstrap. currentPhrase.id is included so queue-driven hosts
    // that swap the in-array identity without changing index also re-run.
  }, [currentIndex, currentPhrase.id, presentationVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transition to recording once the mic opens. Preserve the 'tryAgain'
  // status so Try Again passes continue to emit PracticeAttempt events (and
  // get rendered as retry rows in session history) rather than being
  // reclassified as scored Attempt events when the mic reopens.
  useEffect(() => {
    if (stt.isRecording && statusRef.current !== 'tryAgain') {
      setStatus('recording');
    }
  }, [stt.isRecording]);

  // Record the timestamp of the first is_final=true for this phrase
  // presentation so we can measure the debounce age when we finally emit.
  useEffect(() => {
    if (stt.isFinal && firstIsFinalAtRef.current === null) {
      firstIsFinalAtRef.current = Date.now();
    }
  }, [stt.isFinal]);

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

      try {
        await playSuccessChimeRef.current(ac.signal);
      } catch {
        if (ac.signal.aborted) return;
      }
      if (ac.signal.aborted) return;

      postSoundTimer = setTimeout(() => {
        postSoundTimer = null;
        if (ac.signal.aborted) return;
        // Emit at fire time so sttRef has the full utterance if additional
        // segments landed during the chime + post-success pause.
        if (!attemptEmittedRef.current) {
          const fireNow = Date.now();
          const captureCaption = sttRef.current.caption;
          const captureWords = sttRef.current.words;
          const msAge =
            firstIsFinalAtRef.current !== null
              ? fireNow - firstIsFinalAtRef.current
              : null;
          if (debugLearningPipelineRef.current) {
            logAttemptFireSource({
              phraseId: currentPhrase.id,
              trigger: statusRef.current === 'tryAgain' ? 'practice' : 'success-path-timer',
              captionAtFire: captureCaption,
              wordCountAtFire: captureWords.length,
              isFinalAtFire: sttRef.current.isFinal,
              msSinceFirstFinal: msAge,
            });
          }
          if (statusRef.current === 'tryAgain') {
            emitPracticeAttempt(captureCaption, captureWords, fireNow);
          } else {
            emitAttempt(captureCaption, captureWords, fireNow, {
              trigger: 'success-path-timer',
              isFinalAtCapture: sttRef.current.isFinal,
              msSinceFirstFinal: msAge,
            });
          }
        }
        void playAnswerAudio();
      }, POST_SUCCESS_EXTRA_PAUSE_MS);
    })();

    return () => {
      ac.abort();
      if (postSoundTimer !== null) clearTimeout(postSoundTimer);
    };
  }, [isCorrect, status, currentIndex, playAnswerAudio, emitAttempt, emitPracticeAttempt, currentPhrase.id]);

  // Final wrong transcript: score synchronously the moment Deepgram closes
  // the utterance (speech_final=true, or UtteranceEnd fallback). The STT
  // adapter's endpointing (1500 ms) already provides the "wait for silence"
  // debounce — there's no benefit to layering a client-side timer on top.
  // Scoring here runs only when stt.isFinal flips true AND the caption is
  // not a match (the isCorrect branch above owns the success path).
  useEffect(() => {
    if (!stt.isFinal || isCorrect || (status !== 'recording' && status !== 'tryAgain')) {
      return;
    }
    if (attemptEmittedRef.current) {
      void playAnswerAudio();
      return;
    }

    const phraseId = currentPhrase.id;
    const fireNow = Date.now();
    const captureCaption = sttRef.current.caption;
    const captureWords = sttRef.current.words;
    const msAge =
      firstIsFinalAtRef.current !== null
        ? fireNow - firstIsFinalAtRef.current
        : null;
    if (debugLearningPipelineRef.current) {
      logAttemptFireSource({
        phraseId,
        trigger: statusRef.current === 'tryAgain' ? 'practice' : 'speech-final',
        captionAtFire: captureCaption,
        wordCountAtFire: captureWords.length,
        isFinalAtFire: sttRef.current.isFinal,
        msSinceFirstFinal: msAge,
      });
    }
    if (statusRef.current === 'tryAgain') {
      emitPracticeAttempt(captureCaption, captureWords, fireNow);
    } else {
      emitAttempt(captureCaption, captureWords, fireNow, {
        trigger: 'speech-final',
        isFinalAtCapture: sttRef.current.isFinal,
        msSinceFirstFinal: msAge,
      });
    }
    void playAnswerAudio();
  }, [
    stt.isFinal,
    isCorrect,
    status,
    currentIndex,
    playAnswerAudio,
    emitAttempt,
    emitPracticeAttempt,
    currentPhrase.id,
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
      await ttsRef.current.play(
        spanishText,
        'es',
        PLAYBACK_RATES[speed],
        ttsPhraseIndexRef.current,
      );
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
