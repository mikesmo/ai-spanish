import { useCallback, useRef, useState } from 'react';
import { configure, useDeepgramSpeechToText } from 'react-native-deepgram';
import { prefetchListenKey, resolveKeyForListen } from './deepgramAuthKey.native';
import {
  getDefaultLearningPipelineDebug,
  logSttAdapterStart,
  logSttAdapterStop,
  logSttDeepgramKeywordsSent,
  logSttClear,
  logSttSegment,
  logSttUtteranceEnd,
  toDeepgramLiveKeywordParams,
  type SpeechToTextHandle,
  type SpokenWord,
  type SttStartOptions,
} from '@ai-spanish/logic';
import {
  spokenWordsFromDeepgramRaw,
  syntheticSpokenWordsFromTextSegment,
} from './deepgramSpokenWords';

/** Matches `useDeepgramSpeechToText`’s second arg (`{ isFinal, raw }`). */
type NativeOnTranscriptEvent = { isFinal?: boolean; raw?: unknown };

/**
 * Deepgram live options — mirrors the web adapter's `DEEPGRAM_OPTIONS` so
 * both platforms transcribe with the same behaviour. Key notes:
 *   - `language: 'es-ES'` for Castilian Spanish parity with web.
 *   - `smartFormat: true` supersedes `punctuate` — enables capitalization,
 *     punctuation, numeric normalization, etc. in one knob.
 *   - `fillerWords` is NOT enabled: we don't want "um"/"uh"/"eh" tokens
 *     muddying the accuracy diff for beginner learners.
 *   - `endpointing: 1500` matches web: 1500 ms of silence is Deepgram's
 *     VAD-driven utterance close signal (fires `is_final=true` +
 *     `speech_final=true`).
 *   - `utteranceEndMs` is intentionally unset. Its word-timing-based
 *     silence detector was empirically firing prematurely on beginner
 *     pauses on web, so both platforms rely solely on VAD endpointing
 *     (plus our client-side INACTIVITY_WATCHDOG_MS fallback below).
 */
const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-2',
  language: 'es-ES',
  interimResults: true,
  smartFormat: true,
  endpointing: 1500,
} as const;

const INACTIVITY_WATCHDOG_MS = 3000;
const INITIAL_SILENCE_TIMEOUT_MS = 6000;
const NATIVE_STOP_SETTLE_MS = 50;

/**
 * The native SDK does not expose `speech_final`; a chunk with `isFinal` may be
 * mid-utterance. We debounce the commit so a following interim can cancel it,
 * approximating web `speech_final` + endpointing.
 */
const IS_FINAL_COMMIT_DEBOUNCE_MS = 800;

/**
 * `react-native-deepgram`’s `stopListening` returns before recording fully stops;
 * a short settle before `startListening` avoids "session already active".
 */
export function useSTT(): SpeechToTextHandle {
  const [caption, setCaption] = useState('');
  const [isFinal, setIsFinalState] = useState(false);
  const [words, setWords] = useState<SpokenWord[]>([]);
  const [sttError, setSttError] = useState<string | null>(null);
  const paragraphRef = useRef('');
  const lastCaptionRef = useRef('');
  const finalizedCountRef = useRef(0);
  /** `is_final` words committed to the current utterance (mirrors web). */
  const finalizedWordsRef = useRef<SpokenWord[]>([]);
  /** Latest interim segment only. */
  const pendingInterimWordsRef = useRef<SpokenWord[]>([]);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const finalCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopListeningRef = useRef<() => void>(() => {});
  /** Bumped in `start` / `stop` so a deferred IIFE from a previous `start` cannot call `startListening` after a quick `stop`. */
  const startEpochRef = useRef(0);
  const stopInFlightRef = useRef<Promise<void> | null>(null);
  const debugRef = useRef(getDefaultLearningPipelineDebug());
  debugRef.current = getDefaultLearningPipelineDebug();

  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const clearInitialSilenceTimer = useCallback(() => {
    if (initialSilenceTimerRef.current) {
      clearTimeout(initialSilenceTimerRef.current);
      initialSilenceTimerRef.current = null;
    }
  }, []);

  const clearFinalCommitTimer = useCallback(() => {
    if (finalCommitTimerRef.current) {
      clearTimeout(finalCommitTimerRef.current);
      finalCommitTimerRef.current = null;
    }
  }, []);

  const fireWatchdog = useCallback(() => {
    inactivityTimerRef.current = null;
    clearFinalCommitTimer();
    const pending = pendingInterimWordsRef.current;
    if (pending.length > 0) {
      finalizedWordsRef.current = [...finalizedWordsRef.current, ...pending];
      pendingInterimWordsRef.current = [];
      setWords([...finalizedWordsRef.current]);
    }
    paragraphRef.current = lastCaptionRef.current;
    setIsFinalState(true);
    finalizedCountRef.current += 1;
    try {
      stopListeningRef.current();
    } catch {
      // swallow
    }
    if (debugRef.current) {
      logSttUtteranceEnd({
        totalFinalized: finalizedCountRef.current,
        caption: lastCaptionRef.current,
        trigger: 'inactivity-watchdog',
      });
    }
  }, [clearFinalCommitTimer]);

  const armInactivityWatchdog = useCallback(() => {
    clearInactivityTimer();
    inactivityTimerRef.current = setTimeout(
      fireWatchdog,
      INACTIVITY_WATCHDOG_MS,
    );
  }, [clearInactivityTimer, fireWatchdog]);

  const { startListening, stopListening, state } = useDeepgramSpeechToText({
    trackState: true,
    onStart: () => {
      prefetchListenKey();
    },
    onTranscript: (text: string, event?: NativeOnTranscriptEvent) => {
      if (text !== '') clearInitialSilenceTimer();
      const raw = event?.raw;

      const runDebouncedCommit = (segmentWordCount: number, transcriptLine: string) => {
        clearFinalCommitTimer();
        const myEpoch = startEpochRef.current;
        finalCommitTimerRef.current = setTimeout(() => {
          finalCommitTimerRef.current = null;
          // Bail if stop() or a new start() ran while we were debouncing —
          // both bump startEpochRef, so this commit belongs to a stale attempt.
          if (startEpochRef.current !== myEpoch) return;
          paragraphRef.current = lastCaptionRef.current;
          finalizedCountRef.current += 1;
          setIsFinalState(true);
          clearInactivityTimer();
          try {
            stopListeningRef.current();
          } catch {
            // swallow
          }
          if (debugRef.current) {
            logSttSegment({
              isFinal: true,
              segmentWords: segmentWordCount,
              totalFinalized: finalizedCountRef.current,
              totalWords: lastCaptionRef.current
                .split(/\s+/)
                .filter(Boolean).length,
              transcript: transcriptLine,
              captionLen: lastCaptionRef.current.length,
            });
            logSttUtteranceEnd({
              totalFinalized: finalizedCountRef.current,
              caption: lastCaptionRef.current,
              trigger: 'speech-final',
            });
          }
        }, IS_FINAL_COMMIT_DEBOUNCE_MS);
      };

      if (text === '') {
        if (event?.isFinal) {
          // Speech-final with empty string (rare) — close using pending interims
          // if the SDK ever emits that pattern.
          const pending = pendingInterimWordsRef.current;
          if (pending.length > 0) {
            finalizedWordsRef.current = [...finalizedWordsRef.current, ...pending];
            pendingInterimWordsRef.current = [];
            setWords([...finalizedWordsRef.current]);
          }
          clearInactivityTimer();
          runDebouncedCommit(0, '');
        }
        return;
      }

      let segmentWords = spokenWordsFromDeepgramRaw(raw);
      if (segmentWords.length === 0) {
        segmentWords = syntheticSpokenWordsFromTextSegment(text);
      }
      const segmentWordCount = segmentWords.length;

      const newCaption = (paragraphRef.current + ' ' + text).trim();
      lastCaptionRef.current = newCaption;
      setCaption(newCaption);

      if (event?.isFinal) {
        finalizedWordsRef.current = [
          ...finalizedWordsRef.current,
          ...segmentWords,
        ];
        pendingInterimWordsRef.current = [];
        setWords([...finalizedWordsRef.current]);
        paragraphRef.current = newCaption;
        clearInactivityTimer();
        runDebouncedCommit(
          segmentWordCount > 0
            ? segmentWordCount
            : text.split(/\s+/).filter(Boolean).length,
          text,
        );
      } else {
        clearFinalCommitTimer();
        pendingInterimWordsRef.current = segmentWords;
        setWords([...finalizedWordsRef.current, ...segmentWords]);
        setIsFinalState(false);
        armInactivityWatchdog();
        if (debugRef.current) {
          const merged = [...finalizedWordsRef.current, ...segmentWords];
          logSttSegment({
            isFinal: false,
            segmentWords: segmentWordCount,
            totalFinalized: finalizedCountRef.current,
            totalWords: merged.length,
            transcript: text,
            captionLen: newCaption.length,
          });
        }
      }
    },
    onError: (err: unknown) => console.error('[Deepgram STT]', err),
    live: DEEPGRAM_LIVE_OPTIONS,
  });

  stopListeningRef.current = stopListening;

  const clearTranscription = useCallback(() => {
    const prevCaptionLen = lastCaptionRef.current.length;
    const prevFinalized = finalizedCountRef.current;
    setCaption('');
    setIsFinalState(false);
    finalizedWordsRef.current = [];
    pendingInterimWordsRef.current = [];
    setWords([]);
    paragraphRef.current = '';
    lastCaptionRef.current = '';
    finalizedCountRef.current = 0;
    clearInactivityTimer();
    clearInitialSilenceTimer();
    clearFinalCommitTimer();
    // Bump epoch so any in-flight start() IIFE (mid-settle or mid-startListening)
    // sees a new epoch and bails rather than proceeding to listen.
    startEpochRef.current += 1;
    try {
      stopListeningRef.current();
    } catch {
      // ignore
    }
    if (debugRef.current) {
      logSttClear({ prevFinalized, prevCaptionLen });
    }
  }, [
    clearInactivityTimer,
    clearInitialSilenceTimer,
    clearFinalCommitTimer,
  ]);

  const runStopSync = () => {
    startEpochRef.current += 1;
    clearInactivityTimer();
    clearInitialSilenceTimer();
    clearFinalCommitTimer();
    stopListening();
  };

  return {
    start: (options?: SttStartOptions) => {
      if (options?.signal?.aborted) {
        return;
      }
      setSttError(null);
      if (debugRef.current) {
        logSttAdapterStart({
          connState: 'unknown',
          micState: state?.status ?? 'idle',
          path: 'startMic-direct',
          keywords: options?.keywords,
        });
      }
      startEpochRef.current += 1;
      const myEpoch = startEpochRef.current;
      clearInitialSilenceTimer();
      clearFinalCommitTimer();
      const kws = options?.keywords;
      const listenOpts =
        kws && kws.length > 0
          ? { keywords: toDeepgramLiveKeywordParams(kws) }
          : undefined;

      void (async () => {
        try {
          stopListeningRef.current();
        } catch {
          // ignore
        }
        if (startEpochRef.current !== myEpoch) {
          return;
        }
        await new Promise<void>((r) => setTimeout(r, NATIVE_STOP_SETTLE_MS));
        if (startEpochRef.current !== myEpoch) {
          try { stopListeningRef.current(); } catch { /* empty */ }
          return;
        }
        if (options?.signal?.aborted) {
          try { stopListeningRef.current(); } catch { /* empty */ }
          return;
        }
        let apiKey: string;
        try {
          apiKey = await resolveKeyForListen();
        } catch (err) {
          console.error('[Deepgram STT] auth key', err);
          setSttError(err instanceof Error ? err.message : String(err));
          return;
        }
        // Single combined guard — configure() is synchronous so epoch/signal
        // cannot change between here and the await startListening() below.
        if (startEpochRef.current !== myEpoch || options?.signal?.aborted) {
          try { stopListeningRef.current(); } catch { /* empty */ }
          return;
        }
        configure({ apiKey });
        if (startEpochRef.current !== myEpoch || options?.signal?.aborted) {
          try { stopListeningRef.current(); } catch { /* empty */ }
          return;
        }
        try {
          if (listenOpts) {
            logSttDeepgramKeywordsSent(listenOpts.keywords);
            await startListening(listenOpts);
          } else {
            await startListening();
          }
        } catch {
          return;
        }
        if (startEpochRef.current !== myEpoch) {
          try { stopListeningRef.current(); } catch { /* empty */ }
          return;
        }
        if (options?.signal?.aborted) {
          try { stopListeningRef.current(); } catch { /* empty */ }
          return;
        }
        clearInitialSilenceTimer();
        initialSilenceTimerRef.current = setTimeout(() => {
          initialSilenceTimerRef.current = null;
          if (startEpochRef.current !== myEpoch) return;
          const pending = pendingInterimWordsRef.current;
          if (pending.length > 0) {
            finalizedWordsRef.current = [...finalizedWordsRef.current, ...pending];
            pendingInterimWordsRef.current = [];
            setWords([...finalizedWordsRef.current]);
          }
          setIsFinalState(true);
          try {
            stopListeningRef.current();
          } catch { /* empty */ }
          if (debugRef.current) {
            logSttUtteranceEnd({
              totalFinalized: finalizedCountRef.current,
              caption: lastCaptionRef.current,
              trigger: 'initial-silence-timeout',
            });
          }
        }, INITIAL_SILENCE_TIMEOUT_MS);
      })();
    },
    stop: (): void | Promise<void> => {
      if (debugRef.current) {
        logSttAdapterStop({
          connState: 'unknown',
          micState: state?.status ?? 'idle',
        });
      }
      if (!stopInFlightRef.current) {
        stopInFlightRef.current = new Promise<void>((resolve) => {
          runStopSync();
          resolve();
        }).finally(() => {
          stopInFlightRef.current = null;
        });
      }
      return stopInFlightRef.current;
    },
    isRecording: state?.status === 'listening',
    caption,
    words,
    isFinal,
    clearTranscription,
    error: sttError,
  };
}
