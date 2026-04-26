'use client';

import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
} from 'react';
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
  logShowAnswerTryAgainNoProgress,
} from './learningPipelineDebug';
import { computeMastery, fluencyForMastery } from './mastery';
import { POST_SUCCESS_EXTRA_PAUSE_MS } from './phraseDisplayTiming';
import { tokenizeForDeepgramKeywords } from './deepgramKeywords';
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

/** First N logical deck positions (0-based) get recording priming audio before the mic. */
const RECORDING_PRIMING_PHRASE_COUNT = 3;

export type UsePhraseDisplayOptions = {
  /** Web: play a short success sound; must resolve when finished or reject on abort. */
  playSuccessChime?: (signal: AbortSignal) => Promise<void>;
  /**
   * First three phrases in the deck (by `ttsPhraseIndex ?? currentIndex`,
   * indices 0–2), only on the **first** in-session presentation of that phrase
   * id (skipped on revisits). Play after bootstrap TTS and before `stt.start`.
   * Must resolve when finished or reject on abort.
   */
  playRecordingPrimingAudio?: (signal: AbortSignal) => Promise<void>;
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
  /**
   * When set, correct answers on the first-pass pronunciation-attempt screen
   * (`new` + first session presentation + no Try Again) invoke this instead
   * of `playAnswerAudio` / `answer` UI. Host should advance like post-feedback
   * Next (e.g. `runPhraseFeedbackNext`).
   */
  onSkipAnswerScreenAfterSuccess?: () => void;
};

const splitWords = (s: string): string[] =>
  s.trim().split(/\s+/).filter(Boolean);

/** True when `answer` is a single whitespace-separated word (for Deepgram keyword biasing). */
const isSingleWordAnswer = (answer: string): boolean =>
  splitWords(answer).length === 1;

/** Caption for scoring on Show Answer: prefer live caption, else join STT words. */
function captionAndGradableFromStt(
  caption: string | undefined,
  words: SpokenWord[],
): { finalCaption: string; hasGradableSpeech: boolean } {
  const trimmed = caption?.trim() ?? '';
  const fromWords = words.map((w) => w.word).join(' ').trim();
  const finalCaption = trimmed.length > 0 ? trimmed : fromWords;
  const hasGradableSpeech = finalCaption.length > 0 || words.length > 0;
  return { finalCaption, hasGradableSpeech };
}

// UIStatus flow (see `UIStatus` in types.ts):
//
//   loading — initial phrase bootstrap (prefetch + English TTS starting).
//   idle — brief pre-mic; often skipped perceptually.
//   pronunciationExample — only for `Phrase.type === 'new'` on the first
//     in-session presentation of that phrase id; then Spanish TTS.
//   recordingPriming — optional clip before mic for the first three phrases,
//     first presentation only (skipped on session revisits; host callback).
//   recording — STT is active; learner speaks the answer.
//   tryAgain — same card after “Try again”; still records PracticeAttempt.
//   answer — feedback, replay, next.
//
//   loading → … → answer → (next phrase → loading) or (Try again → tryAgain
//   → recording → answer). `idle`, `pronunciationExample`, and `recordingPriming`
//   are optional branches after `loading` before `recording` depending on card
//   type and host options.
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
  const [hasUsedTryAgainOnCurrentCard, setHasUsedTryAgainOnCurrentCard] =
    useState(false);
  const [isFirstSessionPresentationOfCurrentPhrase, setIsFirstOfCurrentPhrase] =
    useState(true);
  const isFirstOfCurrentPhraseForBootstrapRef = useRef(true);
  /**
   * Set only in useLayout (presentation) after map + isFirst is computed, so
   * phrase bootstrap TTS never races Strict double-effects vs reading the map
   * in useEffect (first init could see count 0 and play en-second-intro).
   */
  const introTtsForBootstrapRef = useRef<{
    notifyKey: string;
    useFirstIntroClips: boolean;
    isFirstSessionPresentation: boolean;
  } | null>(null);

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

  const playRecordingPrimingAudio = options?.playRecordingPrimingAudio;
  const playRecordingPrimingAudioRef = useRef(playRecordingPrimingAudio);
  playRecordingPrimingAudioRef.current = playRecordingPrimingAudio;

  const onPhraseEventRef = useRef(options?.onPhraseEvent);
  onPhraseEventRef.current = options?.onPhraseEvent;

  const onPresentationStartRef = useRef(options?.onPresentationStart);
  onPresentationStartRef.current = options?.onPresentationStart;

  const onSkipAnswerScreenAfterSuccessRef = useRef(
    options?.onSkipAnswerScreenAfterSuccess,
  );
  onSkipAnswerScreenAfterSuccessRef.current =
    options?.onSkipAnswerScreenAfterSuccess;

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

  /** Tracks whether an Attempt/PracticeAttempt/Reveal (or tryAgain no-speech Show Answer)
   * has already been recorded for the current pass. Suppresses duplicate emissions. */
  const attemptEmittedRef = useRef(false);
  const statusRef = useRef<UIStatus>(status);
  statusRef.current = status;

  /** Timestamp (ms since epoch) of the first is_final=true for the current
   * phrase presentation. Used as an observability metric in
   * `logAttemptFireSource` — shows how much time elapsed between Deepgram's
   * first finalized segment and the moment we actually emit the Attempt
   * (≈0 ms for speech-final, success-chime duration for success-path-timer). */
  const firstIsFinalAtRef = useRef<number | null>(null);
  /** Suppress overlapping calls when e.g. Show Answer and speech-final both fire. */
  const answerAudioInFlightRef = useRef(false);
  const prevIndexRef = useRef<number | null>(null);
  /**
   * Suppress duplicate `onPresentationStart` when React Strict Mode (or any
   * identical-deps re-run) invokes the phrase bootstrap effect twice for the
   * same logical card. Key: index|phraseId|presentationVersion.
   */
  const lastPresentationNotifyKeyRef = useRef<string | null>(null);
  /**
   * Last `${ttsPhraseIndex|currentIndex}|${phraseId}` for which we bumped the
   * per-`phraseId` session count. A `notifyKey` also includes
   * `presentationVersion` (re-bootstrap / requeue); that must NOT count as
   * another "visit" or first-intro becomes en-second on the first paint.
   */
  const lastSessionCountKeyRef = useRef<string | null>(null);
  /**
   * Session-scoped count of how many times each phrase id was presented.
   * Incremented when the stable display position changes (index + id), not
   * when only `presentationVersion` bumps. Used for `first-intro` vs `second-intro` S3.
   */
  const phraseIdPresentationCountRef = useRef<Map<string, number>>(new Map());
  /**
   * False after Try Again so a future English replay would not use
   * `en-first-intro` clip mode; cleared to true on each new presentation notification.
   */
  const englishFirstPassOnCardRef = useRef(true);

  const currentPhrase = phrases[currentIndex]!;
  const en = currentPhrase.English;
  const englishText = en['second-intro']
    ? `${en['second-intro']}: ${en.question}`
    : en.question;
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
        trigger:
          | 'speech-final'
          | 'success-path-timer'
          | 'manual'
          | 'show-answer';
        isFinalAtCapture: boolean;
        msSinceFirstFinal: number | null;
      },
    ) => {
      const target = currentPhrase.Spanish.words;
      const alignment = alignWords(target, words);
      const accuracy = computeAccuracy(target, alignment);
      const fluency = computeFluency(words);
      const fluencyScore = fluency?.fluencyScore ?? null;
      const spokenWordCount = words.length;
      const accuracySucceeded = isAccuracyThresholdReached(accuracy.accuracy);
      const uiSuccess =
        !!finalCaption.trim() &&
        normalizeStr(finalCaption) === normalizeStr(spanishText);
      const mastery = computeMastery(
        accuracy.accuracy,
        fluencyForMastery(fluencyScore, spokenWordCount),
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
        spokenWordCount,
        isAccuracySuccess: accuracySucceeded,
        success: uiSuccess,
        timestamp: now,
        accuracyBreakdown: accuracy,
        fluencyBreakdown: fluency,
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
      const target = currentPhrase.Spanish.words;
      const alignment = alignWords(target, words);
      const accuracy = computeAccuracy(target, alignment);
      const fluency = computeFluency(words);
      if (debugLearningPipelineRef.current) {
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
        accuracyBreakdown: accuracy,
        fluencyBreakdown: fluency,
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
    // Second entry while a reveal is still awaiting TTS (e.g. double tap, or
    // show answer after a race). Without this we no-op and the UI can stay on
    // UserRecording even though the first call already set 'answer' then lost
    // it, or the first call never got to setStatus in edge races.
    if (answerAudioInFlightRef.current) {
      sttRef.current.stop();
      setStatus('answer');
      return;
    }
    answerAudioInFlightRef.current = true;
    try {
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
    } finally {
      answerAudioInFlightRef.current = false;
    }
  }, [spanishText]);

  /**
   * User clicked "Show Answer". If nothing was scored yet for this pass:
   * first pass with gradable STT → Attempt; first pass with no speech → Reveal;
   * Try Again with gradable STT → PracticeAttempt; Try Again with no speech →
   * only mark emitted (no event — must not decay mastery).
   */
  const handleShowAnswer = useCallback(async () => {
    if (attemptEmittedRef.current) {
      if (debugLearningPipelineRef.current) {
        logRevealSkipped(currentPhrase.id);
      }
      await playAnswerAudio();
      return;
    }

    const now = Date.now();
    const words = sttRef.current.words;
    const { finalCaption, hasGradableSpeech } = captionAndGradableFromStt(
      sttRef.current.caption,
      words,
    );
    const msSinceFirstFinal =
      firstIsFinalAtRef.current !== null
        ? now - firstIsFinalAtRef.current
        : null;
    const isTryAgain = statusRef.current === 'tryAgain';

    if (isTryAgain) {
      if (hasGradableSpeech) {
        emitPracticeAttempt(finalCaption, words, now);
      } else {
        attemptEmittedRef.current = true;
        if (debugLearningPipelineRef.current) {
          logShowAnswerTryAgainNoProgress(currentPhrase.id);
        }
      }
    } else if (hasGradableSpeech) {
      emitAttempt(finalCaption, words, now, {
        trigger: 'show-answer',
        isFinalAtCapture: sttRef.current.isFinal,
        msSinceFirstFinal,
      });
    } else {
      emitReveal(now);
    }

    await playAnswerAudio();
  }, [
    currentPhrase.id,
    emitAttempt,
    emitPracticeAttempt,
    emitReveal,
    playAnswerAudio,
  ]);

  // Presentation count + onPresentationStart (once per notify key). Runs in
  // useLayoutEffect so the async bootstrap and UI can read a stable
  // first/m repeat flag before paint and without duplicating this block.
  useLayoutEffect(() => {
    const notifyKey = `${currentIndex}|${currentPhrase.id}|${presentationVersion ?? ''}`;
    const shouldNotifyPresentation =
      lastPresentationNotifyKeyRef.current !== notifyKey;
    const countStableKey = `${ttsPhraseIndex}|${currentPhrase.id}`;
    const isNewLogicalPosition =
      lastSessionCountKeyRef.current !== countStableKey;
    const phraseId = currentPhrase.id;
    let isFirstSessionPresentation = false;
    if (shouldNotifyPresentation) {
      lastPresentationNotifyKeyRef.current = notifyKey;
      if (isNewLogicalPosition) {
        onPresentationStartRef.current?.(currentPhrase);
        const c =
          (phraseIdPresentationCountRef.current.get(phraseId) ?? 0) + 1;
        phraseIdPresentationCountRef.current.set(phraseId, c);
        lastSessionCountKeyRef.current = countStableKey;
      }
      englishFirstPassOnCardRef.current = true;
    }
    {
      const c = phraseIdPresentationCountRef.current.get(phraseId) ?? 0;
      isFirstSessionPresentation = c === 1;
    }
    isFirstOfCurrentPhraseForBootstrapRef.current = isFirstSessionPresentation;
    setIsFirstOfCurrentPhrase(isFirstSessionPresentation);
    {
      const enL = currentPhrase.English;
      const hasFirstIntro = (enL['first-intro'] ?? '').trim() !== '';
      const useFirstClips =
        hasFirstIntro &&
        isFirstSessionPresentation &&
        englishFirstPassOnCardRef.current;
      introTtsForBootstrapRef.current = {
        notifyKey,
        useFirstIntroClips: useFirstClips,
        isFirstSessionPresentation,
      };
    }
  }, [currentIndex, currentPhrase.id, presentationVersion, ttsPhraseIndex]);

  // On phrase change: prefetch both audios, play English prompt, then auto-start recording.
  useEffect(() => {
    setStatus('loading');
    setIsAudioPlaying(false);
    setLastScoreBreakdown(null);
    setHasUsedTryAgainOnCurrentCard(false);
    attemptEmittedRef.current = false;
    answerAudioInFlightRef.current = false;
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
    // Prefer intro bit written in useLayout (same notifyKey) so the first of two
    // strict-mode effect runs does not recompute from the map before it matches
    // layout and pick en-second-intro; fallback if keys drift (HMR, bug).
    const enB = currentPhrase.English;
    const notifyKey = `${currentIndex}|${currentPhrase.id}|${
      presentationVersion ?? ''
    }`;
    const fromLayout = introTtsForBootstrapRef.current;
    let isFirstSessionPresentation: boolean;
    let useFirstIntroClips: boolean;
    if (fromLayout && fromLayout.notifyKey === notifyKey) {
      useFirstIntroClips = fromLayout.useFirstIntroClips;
      isFirstSessionPresentation = fromLayout.isFirstSessionPresentation;
    } else {
      const englishUseFirstIntroLocal =
        (enB['first-intro'] ?? '').trim() !== '';
      const n =
        phraseIdPresentationCountRef.current.get(currentPhrase.id) ?? 0;
      isFirstSessionPresentation = n === 1;
      useFirstIntroClips =
        englishUseFirstIntroLocal &&
        isFirstSessionPresentation &&
        englishFirstPassOnCardRef.current;
    }
    const introTextForClips = useFirstIntroClips
      ? (enB['first-intro'] ?? '')
      : (enB['second-intro'] ?? '');
    const englishAppendQuestion = introTextForClips.trimEnd().endsWith(':');
    const enOpts = {
      englishUseFirstIntro: useFirstIntroClips,
      englishAppendQuestion,
    };
    const isNewLessonCard = currentPhrase.type === 'new';
    const shouldPronunciationExample =
      isNewLessonCard && isFirstSessionPresentation;

    let cancelled = false;
    const primingAbort = new AbortController();

    const init = async () => {
      try {
        const hintedIndex = ttsPhraseIndexRef.current;
        await Promise.all([
          ttsRef.current.prefetch(englishText, 'en', hintedIndex, enOpts),
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
          enOpts,
        );
        if (cancelled) return;

        if (shouldPronunciationExample) {
          if (!cancelled) {
            setStatus('pronunciationExample');
            setIsAudioPlaying(true);
            try {
              await ttsRef.current.play(
                spanishText,
                'es',
                undefined,
                ttsPhraseIndexRef.current,
              );
            } catch (esError) {
              console.error(
                '[usePhraseDisplay] Error playing Spanish (pronunciation example):',
                esError,
              );
            } finally {
              if (!cancelled) setIsAudioPlaying(false);
            }
          }
        } else if (!cancelled) {
          setIsAudioPlaying(false);
        }

        if (cancelled) return;

        const playPrime = playRecordingPrimingAudioRef.current;
        if (
          ttsPhraseIndexRef.current < RECORDING_PRIMING_PHRASE_COUNT &&
          isFirstSessionPresentation &&
          playPrime
        ) {
          setStatus('recordingPriming');
          try {
            await playPrime(primingAbort.signal);
          } catch (primError: unknown) {
            const aborted =
              cancelled ||
              primingAbort.signal.aborted ||
              (primError instanceof DOMException &&
                primError.name === 'AbortError') ||
              (primError instanceof Error && primError.name === 'AbortError');
            if (aborted) return;
            console.error(
              '[usePhraseDisplay] Recording priming audio:',
              primError,
            );
          }
          if (cancelled || primingAbort.signal.aborted) return;
        }

        // Serialize with phrase-bootstrap cleanup: cleanup calls `stop()` without
        // awaiting; `start()` can open Deepgram and run `startMicrophone()` while
        // the prior MediaRecorder is still "recording", which bails without setting
        // mic state to Open — UI stays on `recordingPriming` forever.
        await Promise.resolve(sttRef.current.stop());
        if (cancelled) return;

        sttRef.current.clearTranscription();
        sttRef.current.start({
          keywords: isSingleWordAnswer(currentPhrase.Spanish.answer)
            ? tokenizeForDeepgramKeywords(currentPhrase.Spanish.answer)
            : [],
        });
      } catch (error) {
        if (!cancelled) {
          console.error('[usePhraseDisplay] Error loading phrase audio:', error);
          setStatus('idle');
          setIsAudioPlaying(false);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
      primingAbort.abort();
      ttsRef.current.stop();
      sttRef.current.stop();
    };
    // Re-run on currentIndex change (linear navigation) AND on
    // presentationVersion bumps from a session engine so a requeued phrase
    // at the same index (or a one-element `phrases` array) still triggers a
    // fresh bootstrap. currentPhrase.id is included so queue-driven hosts
    // that swap the in-array identity without changing index also re-run.
  }, [currentIndex, currentPhrase.id, currentPhrase.type, presentationVersion]);
  // `currentPhrase.English` strings are *not* deps: hot edits without id change
  // are rare; listing them re-ran bootstrap and could pick the wrong S3 intro.

  // Transition to recording once the mic opens. Preserve the 'tryAgain'
  // status so Try Again passes continue to emit PracticeAttempt events (and
  // get rendered as retry rows in session history) rather than being
  // reclassified as scored Attempt events when the mic reopens.
  useEffect(() => {
    if (!stt.isRecording) return;
    if (statusRef.current === 'tryAgain') return;
    // Do not clobber the feedback/loading flow: after `playAnswerAudio` stops
    // STT, native/Deepgram can briefly report `listening` again; without this
    // guard we setStatus('recording') and trap the user back on UserRecording
    // while `playAnswerAudio` is still in flight (show answer no-ops).
    if (statusRef.current === 'answer' || statusRef.current === 'loading') {
      return;
    }
    setStatus('recording');
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
        const skipAnswerScreen =
          currentPhrase.type === 'new' &&
          isFirstSessionPresentationOfCurrentPhrase &&
          !hasUsedTryAgainOnCurrentCard &&
          statusRef.current === 'recording' &&
          onSkipAnswerScreenAfterSuccessRef.current != null;
        if (skipAnswerScreen) {
          onSkipAnswerScreenAfterSuccessRef.current?.();
        } else {
          void playAnswerAudio();
        }
      }, POST_SUCCESS_EXTRA_PAUSE_MS);
    })();

    return () => {
      ac.abort();
      if (postSoundTimer !== null) clearTimeout(postSoundTimer);
    };
  }, [
    isCorrect,
    status,
    currentIndex,
    playAnswerAudio,
    emitAttempt,
    emitPracticeAttempt,
    currentPhrase.id,
    currentPhrase.type,
    isFirstSessionPresentationOfCurrentPhrase,
    hasUsedTryAgainOnCurrentCard,
  ]);

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
    setHasUsedTryAgainOnCurrentCard(true);
    englishFirstPassOnCardRef.current = false;
    ttsRef.current.stop();
    sttRef.current.clearTranscription();
    // Try Again starts a new practice session for this phrase — we do NOT
    // clear attemptEmittedRef because any event emitted in the tryAgain state
    // is a PracticeAttempt; we still want to avoid double-emitting within a
    // single tryAgain pass. Reset specifically the "has emitted for this
    // recording pass" bit.
    attemptEmittedRef.current = false;
    setStatus('tryAgain');
    sttRef.current.start({
      keywords: isSingleWordAnswer(currentPhrase.Spanish.answer)
        ? tokenizeForDeepgramKeywords(currentPhrase.Spanish.answer)
        : [],
    });
  };

  const handleNext = (options?: { exitToLoading?: boolean }) => {
    sttRef.current.clearTranscription();
    if (options?.exitToLoading) {
      setStatus('loading');
    }
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
    hasUsedTryAgainOnCurrentCard,
    isFirstSessionPresentationOfCurrentPhrase,
    lastScoreBreakdown,
  };
}

export { ACCURACY_SUCCESS_THRESHOLD };
