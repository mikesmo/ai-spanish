import { useState, useRef, useCallback, useEffect } from 'react';
import { useDeepgramConnection, LiveConnectionState } from './web/useDeepgram';
import { useMicrophone, MicrophoneState } from './web/useMicrophone';
import type {
  SpeechToTextHandle,
  SpokenWord,
  SttStartOptions,
} from '@ai-spanish/logic';
import {
  getDefaultLearningPipelineDebug,
  logSttAdapterStart,
  logSttAdapterStop,
  logSttClear,
  logSttSegment,
  logSttUtteranceEnd,
} from '@ai-spanish/logic';

const DEEPGRAM_OPTIONS = {
  // nova-2 for Spanish: nova-3's VAD/endpointing was empirically unreliable
  // on our beginner-phrase use case (spoken Spanish in a typical room), with
  // neither speech_final nor UtteranceEnd firing after the learner stopped
  // speaking. nova-2 closes utterances promptly for the same audio. If
  // Deepgram fixes nova-3 Spanish VAD, revisit.
  model: 'nova-2',
  interim_results: true,
  smart_format: true,
  // filler_words is intentionally disabled: for a beginner-phrase learner
  // use case we don't want "um"/"uh"/"eh" tokens polluting the accuracy
  // diff (they'd count as `wrong` words against the target phrase).
  // endpointing: ms of silence before Deepgram's VAD decides the speaker has
  // stopped. When it fires, the next transcript message carries BOTH
  // is_final=true AND speech_final=true — which is our real utterance-close
  // signal. 1500 ms tolerates a mid-phrase hesitation without closing the
  // utterance prematurely; Deepgram's endpointer IS our debounce now that
  // the client-side wrong-path timer has been removed.
  // See: https://developers.deepgram.com/docs/understand-endpointing-interim-results
  endpointing: 1500,
  // NOTE: utterance_end_ms is intentionally NOT set. Its word-timing-based
  // silence detector was firing prematurely on beginner-learner pauses
  // (e.g. "Voy a la librería a comprar…" [think] "…una novela" got cut
  // after "comprar" because 2000 ms elapsed since the last word-end). With
  // utterance_end_ms omitted, Deepgram closes utterances only via VAD
  // endpointing (speech_final), and our client-side INACTIVITY_WATCHDOG_MS
  // below is the safety net if VAD stays warm and never fires. The
  // UtteranceEnd listener in useDeepgram.ts and handleUtteranceEnd in
  // this file remain registered but will never fire — kept as dead code
  // so re-enabling is a one-line revert.
  language: 'es-ES',
} as const;

/**
 * Client-side inactivity watchdog: closes the utterance locally if Deepgram
 * fails to fire `speech_final=true` within this many milliseconds of the
 * last transcript message that carried new words. Now that
 * `utterance_end_ms` has been disabled (see DEEPGRAM_OPTIONS above), this
 * watchdog is the ONLY fallback when VAD endpointing stays warm and never
 * fires speech_final — typically when the learner is mumbling a word they
 * haven't fully recalled yet: VAD hears just enough signal not to count
 * the time as clean silence, but Deepgram can't confidently transcribe
 * anything, so we get a run of empty interims. This value must be long
 * enough to tolerate mid-phrase vocab-retrieval pauses (e.g. "…que te
 * lleves…" [3 s thinking] "…la chaqueta"), but short enough that a
 * genuinely-ended utterance doesn't feel laggy. 4000 ms was arrived at
 * empirically: 2500 ms was cutting users off mid-phrase; 4000 ms covered
 * a long thinking pause we saw in real sessions. Revisit if utterances
 * feel either sluggish or still cut off.
 */
const INACTIVITY_WATCHDOG_MS = 3000;

/**
 * Initial-silence safety net: if the mic starts recording but Deepgram never
 * emits a transcript with any words, we have no "last words arrived" moment
 * to drive INACTIVITY_WATCHDOG_MS from, so without this timer the adapter
 * would hang forever. Arm this the moment audio starts flowing (WS open +
 * mic started); clear it as soon as the first word arrives. Causes seen in
 * the wild:
 *   - Firefox returned a live-but-silent mic track after many start/stop
 *     cycles.
 *   - Learner said the phrase too quietly for Deepgram to cross its
 *     confidence threshold, producing a stream of empty interims only.
 * This must be > INACTIVITY_WATCHDOG_MS because it also covers the
 * "user-is-still-reading-the-prompt" latency before speech begins. If it
 * fires, the attempt closes with zero words (accuracy 0.000) rather than
 * hanging — the user can retry immediately.
 */
const INITIAL_SILENCE_TIMEOUT_MS = 6000;

/**
 * Feature flag: forward per-phrase `keywords` to Deepgram's live transcription
 * for ASR biasing. Driven by the public env var `NEXT_PUBLIC_STT_KEYWORDS_ENABLED`
 * so the flag is readable from the client bundle. Defaults to ENABLED so a
 * deployment without the variable set continues to get keyword biasing (which
 * we added to fix the "algo"→"agol" family of mis-transcriptions); set to
 * `false` / `0` / `off` / `no` to turn it off for A/B comparison or to rule
 * out biasing as a cause when debugging a new ASR regression.
 *
 * Computed once at module init rather than on every buildConnectOptions() call
 * because the value can't change without a page reload (env vars are baked into
 * the Next.js bundle at build time for NEXT_PUBLIC_*).
 */
const KEYWORDS_FEATURE_ENABLED: boolean = (() => {
  const v = process.env.NEXT_PUBLIC_STT_KEYWORDS_ENABLED;
  if (v === undefined || v === '') return true;
  const normalized = v.trim().toLowerCase();
  return (
    normalized !== 'false' &&
    normalized !== '0' &&
    normalized !== 'off' &&
    normalized !== 'no'
  );
})();

export function useSTT(): SpeechToTextHandle {
  const {
    connectionState,
    connectionStateRef,
    connectionFailedSignal,
    onTranscriptRef,
    onUtteranceEndRef,
    connectToDeepgram,
    disconnectFromDeepgram,
    sendVoiceData,
  } = useDeepgramConnection();

  const {
    microphoneState,
    setupMicrophone,
    startMicrophone,
    stopMicrophone,
    teardownMicrophone,
  } = useMicrophone(sendVoiceData);

  const prevConnectionState = useRef<LiveConnectionState>(LiveConnectionState.CLOSED);
  const isIntentionalStop = useRef(false);
  const isUserStarted = useRef(false);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_ATTEMPTS = 5;

  const [caption, setCaption] = useState('');
  const [isFinal, setIsFinal] = useState(false);
  const [words, setWords] = useState<SpokenWord[]>([]);
  const paragraphRef = useRef('');
  const lastCaptionRef = useRef('');
  const finalizedWordsRef = useRef<SpokenWord[]>([]);
  // The most recent interim segment's words. Needed because Deepgram sometimes
  // closes an utterance with `is_final=true, speech_final=true, transcript=''`
  // (a synthetic wrap-up that implicitly commits the prior interim's words).
  // Tracking the last interim lets us commit those words when that happens.
  const pendingInterimWordsRef = useRef<SpokenWord[]>([]);
  // Inactivity watchdog timer (see INACTIVITY_WATCHDOG_MS above).
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Target-phrase tokens to bias Deepgram toward for the NEXT connect. Set
  // by start(options) and read by buildConnectOptions() whenever the adapter
  // opens a new WebSocket (initial mic-Ready, unexpected reconnect, backoff
  // retry). Empty array means "no bias" — falls back to DEEPGRAM_OPTIONS as-is.
  const nextKeywordsRef = useRef<string[]>([]);

  const debugRef = useRef(getDefaultLearningPipelineDebug());
  debugRef.current = getDefaultLearningPipelineDebug();

  const clearWatchdog = useCallback(() => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  // Fires when we've received words but Deepgram never closed the utterance.
  // Synthesizes an utterance-end using the same commit logic as
  // handleUtteranceEnd, but tagged with a distinct trigger so the log clearly
  // indicates this was a client-side fallback (helps diagnose ASR anomalies).
  // NO "already closed" guard here: if this fires at all, it means the
  // watchdog was armed and never cleared — which by construction means no
  // prior close path has run for the current utterance.
  const fireWatchdog = useCallback(() => {
    watchdogTimerRef.current = null;
    const pending = pendingInterimWordsRef.current;
    if (pending.length > 0) {
      finalizedWordsRef.current = [...finalizedWordsRef.current, ...pending];
      setWords(finalizedWordsRef.current);
      pendingInterimWordsRef.current = [];
    }
    paragraphRef.current = lastCaptionRef.current;
    setIsFinal(true);
    if (debugRef.current) {
      logSttUtteranceEnd({
        totalFinalized: finalizedWordsRef.current.length,
        caption: lastCaptionRef.current,
        trigger: 'inactivity-watchdog',
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // (Re-)arm the watchdog. Call with no arg whenever a transcript message
  // carrying NEW words arrives (interim or mid-utterance final) — uses the
  // normal INACTIVITY_WATCHDOG_MS. Call with INITIAL_SILENCE_TIMEOUT_MS
  // from the mic-start paths so that a zero-words-ever session still closes
  // instead of hanging. Critically, do NOT arm on empty-transcript /
  // no-new-word messages during an utterance — those are exactly the
  // useless chunk boundaries we want the watchdog to time out past.
  const armWatchdog = useCallback((timeoutMs: number = INACTIVITY_WATCHDOG_MS) => {
    if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    watchdogTimerRef.current = setTimeout(fireWatchdog, timeoutMs);
  }, [fireWatchdog]);

  // Transcript handler must be registered with stable hook order: all
  // useState/useRef/useCallback before any useEffect in this hook.
  const handleTranscript = useCallback((data: unknown) => {
    const d = data as {
      is_final?: boolean;
      speech_final?: boolean;
      channel?: {
        alternatives?: {
          transcript?: string;
          words?: Array<{
            word?: string;
            punctuated_word?: string;
            start?: number;
            end?: number;
            confidence?: number;
          }>;
        }[];
      };
    };
    const alt = d?.channel?.alternatives?.[0];
    const transcript = alt?.transcript ?? '';
    const isFinalChunk = d?.is_final ?? false;
    // speech_final=true means Deepgram's endpointer detected end-of-speech;
    // this is our real utterance-close signal. is_final=true alone only means
    // a chunk of words has been frozen — the utterance can still continue.
    const isSpeechFinal = d?.speech_final ?? false;
    const rawWords = alt?.words ?? [];

    const segmentWords: SpokenWord[] = rawWords
      .map((w) => ({
        word: (w.punctuated_word ?? w.word ?? '').trim(),
        start: typeof w.start === 'number' ? w.start : NaN,
        end: typeof w.end === 'number' ? w.end : NaN,
        confidence: typeof w.confidence === 'number' ? w.confidence : undefined,
      }))
      .filter(
        (w) =>
          w.word.length > 0 &&
          Number.isFinite(w.start) &&
          Number.isFinite(w.end),
      );

    if (transcript === '') {
      // Empty transcript messages come in three flavours:
      //   - is_final=false: interim with no words yet — ignore.
      //   - is_final=true,  speech_final=false: synthetic chunk boundary (no
      //     new words). Safe to ignore; the utterance continues.
      //   - is_final=true,  speech_final=true: synthetic end-of-utterance.
      //     Implicitly commits the last interim's words. We must close the
      //     utterance here — otherwise `isFinal` never flips and consumers
      //     (usePhraseDisplay's speech-final emit effect) never fire.
      if (isFinalChunk && isSpeechFinal) {
        const pending = pendingInterimWordsRef.current;
        if (pending.length > 0) {
          finalizedWordsRef.current = [...finalizedWordsRef.current, ...pending];
          setWords(finalizedWordsRef.current);
          pendingInterimWordsRef.current = [];
        }
        paragraphRef.current = lastCaptionRef.current;
        setIsFinal(true);
        clearWatchdog();
        if (debugRef.current) {
          logSttUtteranceEnd({
            totalFinalized: finalizedWordsRef.current.length,
            caption: lastCaptionRef.current,
            trigger: 'speech-final',
          });
        }
      }
      if (debugRef.current) {
        logSttSegment({
          isFinal: isFinalChunk,
          speechFinal: isSpeechFinal,
          segmentWords: 0,
          totalFinalized: finalizedWordsRef.current.length,
          totalWords: finalizedWordsRef.current.length,
          transcript,
          captionLen: lastCaptionRef.current.length,
        });
      }
      return;
    }

    const newCaption = (paragraphRef.current + ' ' + transcript).trim();
    lastCaptionRef.current = newCaption;
    setCaption(newCaption);

    let totalWords: number;
    if (isFinalChunk) {
      finalizedWordsRef.current = [...finalizedWordsRef.current, ...segmentWords];
      setWords(finalizedWordsRef.current);
      pendingInterimWordsRef.current = [];
      totalWords = finalizedWordsRef.current.length;
      // Freeze the caption prefix on EVERY final chunk, not just the
      // speech_final one. Deepgram can split a single utterance into
      // multiple is_final=true chunks (e.g. when the learner pauses
      // mid-phrase); the next interim's transcript is relative to the end
      // of the most recent frozen chunk, so if we leave paragraphRef stale
      // the subsequent interim rebuilds the caption from scratch and the
      // prior chunk's text disappears from the displayed caption (though
      // finalizedWordsRef still has the words).
      paragraphRef.current = newCaption;
      if (isSpeechFinal) {
        // End of utterance: flip isFinal so consumers (usePhraseDisplay)
        // advance. Chunks with is_final=true but speech_final=false stay
        // mid-utterance.
        setIsFinal(true);
        clearWatchdog();
        if (debugRef.current) {
          logSttUtteranceEnd({
            totalFinalized: finalizedWordsRef.current.length,
            caption: newCaption,
            trigger: 'speech-final',
          });
        }
      } else {
        setIsFinal(false);
        // Mid-utterance commit: new words arrived. Reset the watchdog so
        // we don't close prematurely while the learner is still talking.
        armWatchdog();
      }
    } else {
      pendingInterimWordsRef.current = segmentWords;
      const merged = [...finalizedWordsRef.current, ...segmentWords];
      setWords(merged);
      setIsFinal(false);
      totalWords = merged.length;
      // Interim with words: reset watchdog.
      armWatchdog();
    }

    if (debugRef.current) {
      logSttSegment({
        isFinal: isFinalChunk,
        speechFinal: isSpeechFinal,
        segmentWords: segmentWords.length,
        totalFinalized: finalizedWordsRef.current.length,
        totalWords,
        transcript,
        captionLen: newCaption.length,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  onTranscriptRef.current = handleTranscript;

  // Safety-net closer for when VAD endpointing doesn't fire speech_final in
  // time (e.g. learner trails off into background noise that keeps VAD warm).
  // Deepgram emits a separate `UtteranceEnd` event after `utterance_end_ms`
  // of silence; we treat it as end-of-utterance only if we haven't already
  // closed via speech_final. We detect "already closed" by checking whether
  // the watchdog timer is still armed: every close path calls clearWatchdog,
  // so a null timer ref means a prior close has run (speech_final or
  // watchdog), or the utterance never had words to begin with.
  const handleUtteranceEnd = useCallback(() => {
    const watchdogWasArmed = watchdogTimerRef.current !== null;
    if (debugRef.current) {
      console.log(
        '[ai-spanish/stt] UtteranceEnd event received',
        'paragraphLen=' + paragraphRef.current.length,
        'lastCaptionLen=' + lastCaptionRef.current.length,
        'pendingInterim=' + pendingInterimWordsRef.current.length,
        'watchdogArmed=' + watchdogWasArmed,
      );
    }
    if (!watchdogWasArmed) {
      return;
    }
    const pending = pendingInterimWordsRef.current;
    if (pending.length > 0) {
      finalizedWordsRef.current = [...finalizedWordsRef.current, ...pending];
      setWords(finalizedWordsRef.current);
      pendingInterimWordsRef.current = [];
    }
    paragraphRef.current = lastCaptionRef.current;
    setIsFinal(true);
    clearWatchdog();
    if (debugRef.current) {
      logSttUtteranceEnd({
        totalFinalized: finalizedWordsRef.current.length,
        caption: lastCaptionRef.current,
        trigger: 'utterance-end-fallback',
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  onUtteranceEndRef.current = handleUtteranceEnd;

  // Merge the current phrase's target words (if any) into Deepgram's connect
  // options. The `:2` intensifier is a moderate boost — high enough to
  // recover short trailing Spanish words like "algo" that the LM otherwise
  // discounts without right-context, but below the `:3+` range where
  // Deepgram's docs warn about hallucinated matches. Must be called at
  // every connectToDeepgram site (initial, unexpected-close reconnect, and
  // backoff retry) so the next WebSocket inherits the currently-armed bias.
  //
  // Gated on KEYWORDS_FEATURE_ENABLED so we can flip the feature off via
  // `NEXT_PUBLIC_STT_KEYWORDS_ENABLED=false` for A/B comparison without
  // touching the call sites (all four adapter paths go through here).
  const buildConnectOptions = () => {
    if (!KEYWORDS_FEATURE_ENABLED) return DEEPGRAM_OPTIONS;
    const kws = nextKeywordsRef.current;
    return kws.length > 0
      ? { ...DEEPGRAM_OPTIONS, keywords: kws.map((w) => `${w}:2`) }
      : DEEPGRAM_OPTIONS;
  };

  const start = (options?: SttStartOptions) => {
    isIntentionalStop.current = false;
    isUserStarted.current = true;
    // When the feature flag is OFF, zero out the ref so every downstream
    // consumer (adapter-start console log, buildConnectOptions(), and the
    // debug-session NDJSON) reports a consistent "no keywords" state rather
    // than misleadingly showing the tokens that WOULD have been sent.
    nextKeywordsRef.current = KEYWORDS_FEATURE_ENABLED
      ? (options?.keywords ?? [])
      : [];
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'961193'},body:JSON.stringify({sessionId:'961193',runId:'cold-start',hypothesisId:'H1-H3-H5',location:'index.web.ts:start',message:'adapter.start() called',data:{connState:String(connectionStateRef.current),micState:String(microphoneState),keywords:nextKeywordsRef.current},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Three-way branch over the current (mic, conn) state:
    //   - conn OPEN                → startMic-direct (fast path; pre-warm was on)
    //   - mic Ready, conn not OPEN → connect-direct (mic warm from prior attempt,
    //                                 WS closed by last stop; open a fresh WS now)
    //   - mic NotSetup / Stopped   → setupMic-async (cold start; mic-Ready effect
    //                                 will then connect, gated on isUserStarted)
    const path: 'startMic-direct' | 'connect-direct' | 'setupMic-async' =
      connectionStateRef.current === LiveConnectionState.OPEN
        ? 'startMic-direct'
        : microphoneState === MicrophoneState.Ready
          ? 'connect-direct'
          : 'setupMic-async';

    if (debugRef.current) {
      logSttAdapterStart({
        connState: String(connectionStateRef.current),
        micState: String(microphoneState),
        path,
        keywords: nextKeywordsRef.current,
      });
    }

    if (path === 'startMic-direct') {
      startMicrophone();
      // WS already open, mic starting synchronously from here — arm the
      // no-speech-ever safety net now. The connectionState useEffect won't
      // re-fire (edge-triggered) so this is the only arming point for this
      // path.
      armWatchdog(INITIAL_SILENCE_TIMEOUT_MS);
    } else if (path === 'connect-direct') {
      // Mic stack is warm from a prior attempt (setupMicrophone is now
      // idempotent and stopMicrophone leaves us in Ready), but the WS was
      // closed by the adapter.stop() that ended the previous attempt. Open
      // a fresh WS with the current keyword bias; the WS-open effect will
      // call startMicrophone() once it connects and isUserStarted is true.
      connectToDeepgram(buildConnectOptions());
    } else {
      setupMicrophone();
    }
  };

  const stop = async () => {
    isIntentionalStop.current = true;
    isUserStarted.current = false;
    if (debugRef.current) {
      logSttAdapterStop({
        connState: String(connectionStateRef.current),
        micState: String(microphoneState),
      });
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    reconnectAttempts.current = 0;
    clearWatchdog();
    await stopMicrophone();
    await disconnectFromDeepgram();
  };

  const clearTranscription = () => {
    if (debugRef.current) {
      logSttClear({
        prevFinalized: finalizedWordsRef.current.length,
        prevCaptionLen: lastCaptionRef.current.length,
      });
    }
    setCaption('');
    setIsFinal(false);
    setWords([]);
    paragraphRef.current = '';
    lastCaptionRef.current = '';
    finalizedWordsRef.current = [];
    pendingInterimWordsRef.current = [];
    clearWatchdog();
  };

  // Pre-warm intentionally DISABLED: the mount effect no longer calls
  // setupMicrophone(), and the mic-Ready effect below is gated on
  // isUserStarted.current. Net result: no getUserMedia prompt, no mic
  // track, and no Deepgram WebSocket open until the user explicitly
  // calls start(). The first start() triggers setupMicrophone (via the
  // NotSetup/Stopped branch in start()); when that completes, the
  // gated effect below opens the WS, and the existing WS-OPEN effect
  // then starts the mic recorder. Trade-off: first start() pays
  // getUserMedia + WS handshake latency instead of having it amortised
  // on page load. Re-enable by restoring setupMicrophone() in the
  // mount effect AND removing the isUserStarted.current guard below.
  useEffect(() => {
    return () => {
      clearWatchdog();
      teardownMicrophone();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect to Deepgram once microphone is ready — but only if the user
  // has called start(). Without this guard, completing setupMicrophone()
  // (e.g. after a stop/start cycle leaves the mic Ready) would
  // auto-open a WebSocket before the next start(), defeating the
  // pre-warm-disabled policy.
  useEffect(() => {
    if (microphoneState === MicrophoneState.Ready && isUserStarted.current) {
      connectToDeepgram(buildConnectOptions());
    }
  }, [microphoneState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start microphone once connection opens (if user has called start()).
  // Arm the initial-silence watchdog here so a zero-words-ever session
  // (e.g. Firefox silent mic, or voice below ASR threshold) still force-
  // closes instead of hanging the adapter.
  useEffect(() => {
    if (connectionState === LiveConnectionState.OPEN && isUserStarted.current) {
      // #region agent log
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'961193'},body:JSON.stringify({sessionId:'961193',runId:'cold-start',hypothesisId:'H1-H3',location:'index.web.ts:wsOpenEffect',message:'WS OPEN → startMicrophone() about to fire',data:{},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      startMicrophone();
      armWatchdog(INITIAL_SILENCE_TIMEOUT_MS);
    }
  }, [connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fast reconnect on unexpected disconnect
  useEffect(() => {
    if (
      connectionState === LiveConnectionState.CLOSED &&
      prevConnectionState.current === LiveConnectionState.OPEN &&
      !isIntentionalStop.current
    ) {
      reconnectAttempts.current = 0;
      connectToDeepgram(buildConnectOptions());
    }
    if (connectionState === LiveConnectionState.OPEN) reconnectAttempts.current = 0;
    prevConnectionState.current = connectionState;
  }, [connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exponential backoff retry on failed connection attempt
  useEffect(() => {
    if (connectionFailedSignal === 0 || isIntentionalStop.current) return;
    reconnectAttempts.current++;
    if (reconnectAttempts.current <= MAX_ATTEMPTS) {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current - 1), 16000);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      // #region agent log
      const scheduledAt = Date.now();
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'961193'},body:JSON.stringify({sessionId:'961193',runId:'cold-start',hypothesisId:'H1-H2-H3',location:'index.web.ts:reconnectEffect:schedule',message:'reconnect scheduled',data:{attempts:reconnectAttempts.current,delayMs:delay,connectionFailedSignal},timestamp:scheduledAt})}).catch(()=>{});
      // #endregion
      reconnectTimer.current = setTimeout(() => {
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'961193'},body:JSON.stringify({sessionId:'961193',runId:'cold-start',hypothesisId:'H1-H2-H3',location:'index.web.ts:reconnectEffect:fire',message:'reconnect timer fired',data:{attempts:reconnectAttempts.current,actualDelayMs:Date.now()-scheduledAt,scheduledDelayMs:delay},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        connectToDeepgram(buildConnectOptions());
      }, delay);
    }
  }, [connectionFailedSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    start,
    stop,
    isRecording: microphoneState === MicrophoneState.Open,
    caption,
    words,
    isFinal,
    clearTranscription,
  };
}
