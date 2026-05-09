import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
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

/**
 * Time after the last interim transcript before we forcibly close the
 * session. Deepgram's server-side endpointing fires `is_final +
 * speech_final` ~1500ms after silence, so the typical interim→final gap
 * is ~1500-2500ms. The watchdog must comfortably exceed that to avoid
 * dropping legitimate late finals (observed up to ~3.5s in production
 * traces when the network/server is buffering). 5000ms gives ~1.5s of
 * headroom over the worst observed case while still recovering quickly
 * from a genuinely dead WebSocket.
 */
const INACTIVITY_WATCHDOG_MS = 5000;
/**
 * Time after gate-opening before we close the session if NO transcripts
 * have arrived. Deepgram occasionally delivers an `is_final` without any
 * preceding interims, and the cumulative latency (audio buffer + endpoint +
 * network) can push that delivery slightly past the previous 6000ms ceiling
 * (observed ~6.8s in traces). 8000ms restores reliable capture of those
 * delayed first-finals while still surfacing a truly dead session.
 */
const INITIAL_SILENCE_TIMEOUT_MS = 8000;
/**
 * Polling interval and ceiling used by `start()` to wait for the SDK to
 * finish tearing down a previously active session (state.status leaves
 * 'listening') before invoking `startListening`. Calling `startListening`
 * while the SDK is mid-teardown yields a session that never receives audio.
 */
const NATIVE_STOP_SETTLE_POLL_MS = 25;
const NATIVE_STOP_SETTLE_TIMEOUT_MS = 1500;
/**
 * Additional fixed dwell after `state.status` reports `'idle'` and before
 * we invoke `startListening`. Empirically, when we tear down an actively
 * listening session and immediately restart, the SDK reports idle ~25-50ms
 * after `stopListening`, but the underlying native audio resources
 * (AVAudioSession / AudioRecord) take longer to fully release. Without
 * this dwell, the next session's mic flag flips to `'listening'` but no
 * audio frames are ever delivered (verified in run logs: 6s
 * INITIAL_SILENCE_TIMEOUT with `statusRef:'listening'` and zero
 * transcripts).
 */
const NATIVE_POST_IDLE_DWELL_MS = 300;
/**
 * After `await startListening()` resolves, the SDK should transition
 * `state.status` from `'idle'` → `'loading'` → `'listening'`. We poll
 * for the FULL transition to `'listening'` (not merely non-idle). The
 * audio-session attachment race can break at either step:
 *   - Stuck at `'idle'`: SDK never even started transitioning (~24% rate
 *     observed pre-fix).
 *   - Stuck at `'loading'`: SDK started transitioning but audio session
 *     never attached, so `'listening'` is never reached and no transcripts
 *     ever flow (observed ~10% rate after the stuck-idle fix).
 * Both manifest as "blank transcript after silence timeout" from the
 * user's perspective. Polling specifically for `'listening'` with a
 * generous 1500ms ceiling catches both, and triggers a single retry
 * (stop + dwell + startListening) when the SDK fails to reach the
 * audio-active state.
 */
const NATIVE_CONFIRM_LISTENING_POLL_MS = 25;
const NATIVE_CONFIRM_LISTENING_TIMEOUT_MS = 1500;
/**
 * Time after gate-open without any transcript event (interim, final, or
 * empty) before we treat the session as audio-stalled and trigger a
 * single recovery (stop + dwell + startListening + confirm). Healthy
 * cycles deliver the first interim within ~1-3 s of gate-open when the
 * user starts speaking immediately, so 3500 ms gives normal "thinking"
 * time without unnecessarily firing on real silence. The
 * `INITIAL_SILENCE_TIMEOUT_MS` (8 s) remains the absolute fallback if
 * recovery itself also produces zero events.
 */
const NATIVE_AUDIO_STALL_PROBE_MS = 3500;

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
interface UseSttOptions {
  language?: string;
}

export function useSTT(hookOptions?: UseSttOptions): SpeechToTextHandle {
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
  /**
   * Generational accept-gate for `onTranscript`. The SDK's underlying
   * connection occasionally delivers trailing events from a previous
   * session immediately after `clearTranscription` + `start`; those events
   * would otherwise overwrite the cleared caption with stale text and
   * finalize against the prior utterance. The gate is opened only after
   * `await startListening()` resolves successfully, and is closed whenever
   * we leave a confirmed-listening state (`clearTranscription`, `stop`, or
   * the start IIFE entering its teardown/auth phase).
   */
  const acceptingTranscriptsRef = useRef(false);
  /**
   * Synchronous flag indicating that a teardown path
   * (`clearTranscription`, `runStopSync`, `fireWatchdog`,
   * `runDebouncedCommit`, `initialSilence` timer) has just issued
   * `stopListening` in this same task. Read by the start IIFE on its
   * next microtask to decide whether to skip its own `stopListening`.
   *
   * Why a flag instead of `stateStatusRef.current === 'listening'`:
   * `state.status` is React state and only updates on re-render,
   * which has not happened yet in the microtask after a synchronous
   * `clearTranscription` + `start` pair. The conditional therefore
   * always sees `'listening'` and double-stops within the same
   * microtask — the exact pattern that leaves native audio resources
   * (AVAudioSession / AudioRecord) in a state where the next
   * `startListening` flips the SDK to `'listening'` but delivers
   * zero audio frames. The flag is set synchronously by every
   * teardown path immediately before its `stopListening`, so the
   * IIFE can deterministically skip the redundant call.
   */
  const stopListeningJustIssuedRef = useRef(false);
  const stopInFlightRef = useRef<Promise<void> | null>(null);
  const debugRef = useRef(getDefaultLearningPipelineDebug());
  debugRef.current = getDefaultLearningPipelineDebug();
  // #region agent log
  const lastClearAtRef = useRef<number>(0);
  const gateOpenedAtRef = useRef<number>(0);
  const firstEventProbeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sawAnyTranscriptRef = useRef<boolean>(false);
  const wsOpenAtRef = useRef<number>(0);
  const audioChunkCountRef = useRef<number>(0);
  const audioChunkBytesRef = useRef<number>(0);
  const mountLoggedRef = useRef<boolean>(false);
  if (!mountLoggedRef.current) {
    mountLoggedRef.current = true;
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-audio-stall',hypothesisId:'H8',location:'index.native.ts:useSTT:mount',message:'useSTT hook mounted (new bundle loaded)',data:{at:Date.now()},timestamp:Date.now()})}).catch(()=>{});
  }
  useEffect(() => {
    const eventName = Platform.select({ ios: 'DeepgramAudioPCM', android: 'AudioChunk' });
    if (!eventName) return;
    const emitter = new NativeEventEmitter(NativeModules.Deepgram);
    const sub = emitter.addListener(eventName, (ev: { data?: number[]; b64?: string }) => {
      audioChunkCountRef.current += 1;
      const bytes = ev?.b64?.length ?? ev?.data?.length ?? 0;
      audioChunkBytesRef.current += bytes;
    });
    return () => {
      sub.remove();
    };
  }, []);
  // #endregion

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
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-watchdog-fix',hypothesisId:'H2',location:'index.native.ts:fireWatchdog:entry',message:'inactivity watchdog fired',data:{captionLen:lastCaptionRef.current.length,msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1,watchdogMs:INACTIVITY_WATCHDOG_MS},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
    acceptingTranscriptsRef.current = false;
    stopListeningJustIssuedRef.current = true;
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

  /**
   * Mirrors `state.status` into a ref so async IIFEs (e.g. inside `start`) can
   * read the latest SDK status across re-renders. The `state` value captured
   * by closure at render time goes stale while we await teardown of a
   * previously-listening session.
   */
  const stateStatusRef = useRef<string>('idle');

  const { startListening, stopListening, state } = useDeepgramSpeechToText({
    trackState: true,
    onStart: () => {
      // #region agent log
      wsOpenAtRef.current = Date.now();
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-audio-stall',hypothesisId:'H5',location:'index.native.ts:onStart:wsOpened',message:'sdk onStart fired (WS opened)',data:{msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1,statusRef:stateStatusRef.current,accepting:acceptingTranscriptsRef.current},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      prefetchListenKey();
    },
    // #region agent log
    onEnd: () => {
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-audio-stall',hypothesisId:'H6',location:'index.native.ts:onEnd:fired',message:'sdk onEnd fired (WS closed)',data:{msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1,statusRef:stateStatusRef.current,accepting:acceptingTranscriptsRef.current,gateAgeMs:gateOpenedAtRef.current?Date.now()-gateOpenedAtRef.current:-1,wsOpenMs:wsOpenAtRef.current?Date.now()-wsOpenAtRef.current:-1,sawAnyTranscript:sawAnyTranscriptRef.current},timestamp:Date.now()})}).catch(()=>{});
    },
    // #endregion
    onTranscript: (text: string, event?: NativeOnTranscriptEvent) => {
      // #region agent log
      const gateAgeMs = gateOpenedAtRef.current ? Date.now() - gateOpenedAtRef.current : -1;
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-clear-new',hypothesisId:'H3',location:'index.native.ts:onTranscript:entry',message:'native onTranscript fired',data:{textLen:text.length,isFinal:!!event?.isFinal,accepting:acceptingTranscriptsRef.current,statusRef:stateStatusRef.current,msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1,gateAgeMs,firstEvent:!sawAnyTranscriptRef.current},timestamp:Date.now()})}).catch(()=>{});
      if (acceptingTranscriptsRef.current) {
        sawAnyTranscriptRef.current = true;
        if (firstEventProbeRef.current) {
          clearTimeout(firstEventProbeRef.current);
          firstEventProbeRef.current = null;
        }
      }
      // #endregion
      if (!acceptingTranscriptsRef.current) return;
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
          acceptingTranscriptsRef.current = false;
          stopListeningJustIssuedRef.current = true;
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
    onError: (err: unknown) => {
      // #region agent log
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-audio-stall',hypothesisId:'H6',location:'index.native.ts:onError:fired',message:'sdk onError fired',data:{err:err instanceof Error?err.message:String(err),msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1,statusRef:stateStatusRef.current,accepting:acceptingTranscriptsRef.current,gateAgeMs:gateOpenedAtRef.current?Date.now()-gateOpenedAtRef.current:-1},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.error('[Deepgram STT]', err);
    },
    live: hookOptions?.language
      ? { ...DEEPGRAM_LIVE_OPTIONS, language: hookOptions.language }
      : DEEPGRAM_LIVE_OPTIONS,
  });

  stopListeningRef.current = stopListening;
  stateStatusRef.current = state?.status ?? 'idle';

  const clearTranscription = useCallback(() => {
    // #region agent log
    lastClearAtRef.current = Date.now();
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-clear-new',hypothesisId:'H1',location:'index.native.ts:clearTranscription:entry',message:'native clearTranscription called',data:{stateStatus:state?.status??'idle',stateStatusRef:stateStatusRef.current,prevEpoch:startEpochRef.current,prevAccepting:acceptingTranscriptsRef.current},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    acceptingTranscriptsRef.current = false;
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
    // #region agent log
    if (firstEventProbeRef.current) {
      clearTimeout(firstEventProbeRef.current);
      firstEventProbeRef.current = null;
    }
    // #endregion
    // Bump epoch so any in-flight start() IIFE (mid-settle or mid-startListening)
    // sees a new epoch and bails rather than proceeding to listen.
    startEpochRef.current += 1;
    stopListeningJustIssuedRef.current = true;
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
    acceptingTranscriptsRef.current = false;
    clearInactivityTimer();
    clearInitialSilenceTimer();
    clearFinalCommitTimer();
    // #region agent log
    if (firstEventProbeRef.current) {
      clearTimeout(firstEventProbeRef.current);
      firstEventProbeRef.current = null;
    }
    // #endregion
    stopListeningJustIssuedRef.current = true;
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
      acceptingTranscriptsRef.current = false;
      clearInitialSilenceTimer();
      clearFinalCommitTimer();
      const kws = options?.keywords;
      const listenOpts =
        kws && kws.length > 0
          ? { keywords: toDeepgramLiveKeywordParams(kws) }
          : undefined;

      void (async () => {
        // Skip our own stopListening if a teardown path
        // (clearTranscription / stop / watchdog / commit / silence
        // timer) just issued one in this same task. Two stopListening
        // calls within the same microtask leave native audio resources
        // (AVAudioSession / AudioRecord) in a teardown state where the
        // next startListening produces a "listening but no audio"
        // session. The flag is the deterministic signal — checking
        // `stateStatusRef.current === 'listening'` is unreliable because
        // React hasn't re-rendered yet to reflect the prior stop.
        const wasJustStopped = stopListeningJustIssuedRef.current;
        stopListeningJustIssuedRef.current = false;
        // #region agent log
        const iifeStart = Date.now();
        fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-clear-new',hypothesisId:'H1',location:'index.native.ts:start:iife-entry',message:'start IIFE entered',data:{stateStatusRef:stateStatusRef.current,wasJustStopped,willStopHere:!wasJustStopped&&stateStatusRef.current==='listening',myEpoch,curEpoch:startEpochRef.current,msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (!wasJustStopped && stateStatusRef.current === 'listening') {
          // Defensive fallback: a leftover listening session that no
          // teardown has stopped (rare; e.g. state recovery after a
          // hot-reload). Issue stop now.
          stopListeningJustIssuedRef.current = true;
          try {
            stopListeningRef.current();
          } catch {
            // ignore
          }
          // Clear the flag after the defensive stop so it doesn't leak
          // into a subsequent start() in the same task.
          stopListeningJustIssuedRef.current = false;
        }
        if (startEpochRef.current !== myEpoch) {
          return;
        }
        // Wait for the SDK to actually finish tearing down a previously
        // active session. `stopListening` returns synchronously but the
        // underlying mic + WebSocket close asynchronously; calling
        // `startListening` while `state.status === 'listening'` produces a
        // session that never receives audio. We poll the ref-mirrored
        // status (closure-stable across renders) and bail on epoch change.
        const settleStartedAt = Date.now();
        while (
          stateStatusRef.current === 'listening' &&
          Date.now() - settleStartedAt < NATIVE_STOP_SETTLE_TIMEOUT_MS
        ) {
          await new Promise<void>((r) => setTimeout(r, NATIVE_STOP_SETTLE_POLL_MS));
          if (startEpochRef.current !== myEpoch) return;
        }
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-clear-new',hypothesisId:'H2',location:'index.native.ts:start:after-settle',message:'settle poll done',data:{settleMs:Date.now()-settleStartedAt,stateStatusRef:stateStatusRef.current,iifeMs:Date.now()-iifeStart,willDwellMs:NATIVE_POST_IDLE_DWELL_MS},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        // Additional fixed dwell to let the OS-level audio resources
        // (AVAudioSession / AudioRecord) fully release before we re-acquire
        // them. The status flag transitions faster than the actual native
        // resource release. Without this dwell, the next startListening
        // succeeds at the SDK layer but the mic produces no audio frames.
        if (NATIVE_POST_IDLE_DWELL_MS > 0) {
          await new Promise<void>((r) => setTimeout(r, NATIVE_POST_IDLE_DWELL_MS));
        }
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
        // Run a single startListening + confirmation poll. Returns:
        //   'listening'    — SDK reached 'listening' (audio session active)
        //   'stuck-startup'— SDK never reached 'listening' within timeout
        //                    (still 'idle' or 'loading' — audio session
        //                    never attached, no transcripts will flow)
        //   'aborted'      — epoch changed or signal aborted
        //   'threw'        — startListening threw
        const tryStartAndConfirm = async (
          attemptLabel: string,
        ): Promise<'listening' | 'stuck-startup' | 'aborted' | 'threw'> => {
          // #region agent log
          const startListeningAt = Date.now();
          // #endregion
          try {
            if (listenOpts) {
              logSttDeepgramKeywordsSent(listenOpts.keywords);
              await startListening(listenOpts);
            } else {
              await startListening();
            }
          } catch (err) {
            // #region agent log
            fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-confirm-poll',hypothesisId:'H1',location:'index.native.ts:start:startListening-throw',message:'startListening threw',data:{attempt:attemptLabel,err:String(err),msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            return 'threw';
          }
          if (startEpochRef.current !== myEpoch || options?.signal?.aborted) {
            return 'aborted';
          }
          // Poll the status mirror until the SDK reaches 'listening'
          // (audio session active). Healthy cycles transition through
          // 'idle' → 'loading' → 'listening' within a few hundred ms; the
          // 1500ms ceiling catches the bug where the SDK acknowledges
          // startListening() and even reaches 'loading', but the audio
          // session never actually attaches and 'listening' is never
          // reached. Both stuck-idle and stuck-loading manifest as
          // "blank transcript" from the user's perspective.
          const confirmStartedAt = Date.now();
          while (
            stateStatusRef.current !== 'listening' &&
            Date.now() - confirmStartedAt < NATIVE_CONFIRM_LISTENING_TIMEOUT_MS
          ) {
            await new Promise<void>((r) => setTimeout(r, NATIVE_CONFIRM_LISTENING_POLL_MS));
            if (startEpochRef.current !== myEpoch || options?.signal?.aborted) {
              return 'aborted';
            }
          }
          const confirmMs = Date.now() - confirmStartedAt;
          const finalStatus = stateStatusRef.current;
          // #region agent log
          fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-confirm-poll',hypothesisId:'H4',location:'index.native.ts:start:confirm-poll-done',message:'confirmation poll completed',data:{attempt:attemptLabel,startListeningMs:confirmStartedAt-startListeningAt,confirmMs,finalStatus,reached:finalStatus==='listening',msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          return finalStatus === 'listening' ? 'listening' : 'stuck-startup';
        };

        let outcome = await tryStartAndConfirm('first');
        if (outcome === 'aborted') {
          try { stopListeningRef.current(); } catch { /* empty */ }
          return;
        }
        // 'threw' means startListening/startRecording rejected (e.g. native
        // start_failed when AudioRecord didn't enter RECORDING state). Treat
        // identically to stuck-startup — dwell and retry once, silently.
        if (outcome === 'threw') {
          // #region agent log
          fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-audio-stall',hypothesisId:'H8',location:'index.native.ts:start:threw-as-stuck-startup',message:'startListening threw (likely start_failed) — treating as stuck-startup, will retry',data:{msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1,stateStatusRef:stateStatusRef.current},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          outcome = 'stuck-startup';
        }
        if (outcome === 'stuck-startup') {
          // The SDK acknowledged startListening but never reached
          // 'listening' — the audio session failed to attach. Tear down
          // and retry once. Mark the teardown path so the next start()
          // (if any) doesn't double-stop.
          stopListeningJustIssuedRef.current = true;
          try {
            stopListeningRef.current();
          } catch { /* empty */ }
          stopListeningJustIssuedRef.current = false;
          // Dwell to let native audio resources release before re-acquire.
          await new Promise<void>((r) => setTimeout(r, NATIVE_POST_IDLE_DWELL_MS));
          if (startEpochRef.current !== myEpoch || options?.signal?.aborted) {
            try { stopListeningRef.current(); } catch { /* empty */ }
            return;
          }
          // #region agent log
          fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-confirm-poll',hypothesisId:'H4',location:'index.native.ts:start:retrying',message:'retrying startListening after stuck-startup',data:{stuckAt:'first-attempt',msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1,stateStatusRef:stateStatusRef.current},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          outcome = await tryStartAndConfirm('retry');
          if (outcome !== 'listening') {
            // Retry also failed; surface as session bail. The host's
            // initial-silence timer will eventually close out the UI.
            // #region agent log
            fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-confirm-poll',hypothesisId:'H4',location:'index.native.ts:start:retry-failed',message:'retry also failed',data:{retryOutcome:outcome,msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            try { stopListeningRef.current(); } catch { /* empty */ }
            return;
          }
        }
        acceptingTranscriptsRef.current = true;
        // #region agent log
        gateOpenedAtRef.current = Date.now();
        sawAnyTranscriptRef.current = false;
        audioChunkCountRef.current = 0;
        audioChunkBytesRef.current = 0;
        if (firstEventProbeRef.current) {
          clearTimeout(firstEventProbeRef.current);
        }
        firstEventProbeRef.current = setTimeout(() => {
          firstEventProbeRef.current = null;
          if (startEpochRef.current !== myEpoch) return;
          if (sawAnyTranscriptRef.current) return;
          fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-audio-stall',hypothesisId:'H7',location:'index.native.ts:firstEventProbe:fired',message:'no transcripts within probe window after gate open (diagnostic only)',data:{probeMs:NATIVE_AUDIO_STALL_PROBE_MS,sawAnyTranscript:sawAnyTranscriptRef.current,statusRef:stateStatusRef.current,accepting:acceptingTranscriptsRef.current,msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1,wsOpenAgoMs:wsOpenAtRef.current?Date.now()-wsOpenAtRef.current:-1,audioChunkCount:audioChunkCountRef.current,audioChunkBytes:audioChunkBytesRef.current},timestamp:Date.now()})}).catch(()=>{});
        }, NATIVE_AUDIO_STALL_PROBE_MS);
        fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-confirm-poll',hypothesisId:'H4',location:'index.native.ts:start:gateOpened',message:'gate opened after confirmed listening',data:{iifeTotalMs:Date.now()-iifeStart,msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1,stateStatusRef:stateStatusRef.current,wasJustStopped,wsOpenAgoMs:wsOpenAtRef.current?Date.now()-wsOpenAtRef.current:-1},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        clearInitialSilenceTimer();
        initialSilenceTimerRef.current = setTimeout(() => {
          // #region agent log
          fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'653b2b'},body:JSON.stringify({sessionId:'653b2b',runId:'native-watchdog-fix',hypothesisId:'H3',location:'index.native.ts:initialSilenceTimer:fired',message:'initial silence timer fired',data:{captionLen:lastCaptionRef.current.length,msSinceClear:lastClearAtRef.current?Date.now()-lastClearAtRef.current:-1,silenceMs:INITIAL_SILENCE_TIMEOUT_MS,epochMatches:startEpochRef.current===myEpoch,audioChunkCount:audioChunkCountRef.current,audioChunkBytes:audioChunkBytesRef.current},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          initialSilenceTimerRef.current = null;
          if (startEpochRef.current !== myEpoch) return;
          const pending = pendingInterimWordsRef.current;
          if (pending.length > 0) {
            finalizedWordsRef.current = [...finalizedWordsRef.current, ...pending];
            pendingInterimWordsRef.current = [];
            setWords([...finalizedWordsRef.current]);
          }
          setIsFinalState(true);
          acceptingTranscriptsRef.current = false;
          stopListeningJustIssuedRef.current = true;
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
