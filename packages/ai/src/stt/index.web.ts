import { useState, useRef, useCallback, useEffect } from 'react';
import { useDeepgramConnection, LiveConnectionState } from './web/useDeepgram';
import { useMicrophone, MicrophoneState } from './web/useMicrophone';
import type { SpeechToTextHandle, SpokenWord } from '@ai-spanish/logic';
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
  filler_words: true,
  // endpointing: ms of silence before Deepgram's VAD decides the speaker has
  // stopped. When it fires, the next transcript message carries BOTH
  // is_final=true AND speech_final=true — which is our real utterance-close
  // signal. 1500 ms tolerates a mid-phrase hesitation without closing the
  // utterance prematurely; Deepgram's endpointer IS our debounce now that
  // the client-side wrong-path timer has been removed.
  // See: https://developers.deepgram.com/docs/understand-endpointing-interim-results
  endpointing: 1500,
  // utterance_end_ms: safety-net fallback when endpointing fails to fire
  // (e.g. learner trails off into noise that keeps VAD warm). Deepgram emits
  // a separate `UtteranceEnd` event type after this much silence, which we
  // subscribe to in useDeepgram.ts. Must be > endpointing.
  // See: https://developers.deepgram.com/docs/utterance-end
  utterance_end_ms: 2000,
  language: 'es',
} as const;

/**
 * Client-side inactivity watchdog: closes the utterance locally if Deepgram
 * fails to fire BOTH `speech_final=true` AND `UtteranceEnd` within this many
 * milliseconds of the last transcript message that carried new words. This is
 * belt-and-suspenders against ASR-side VAD anomalies (observed with nova-3
 * Spanish in some rooms: neither signal ever fires, leaving the UI hung).
 * Must exceed `utterance_end_ms` (2000 ms) so Deepgram has a chance to close
 * the utterance itself under normal conditions.
 */
const INACTIVITY_WATCHDOG_MS = 2500;

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

  const { microphoneState, setupMicrophone, startMicrophone, stopMicrophone } =
    useMicrophone(sendVoiceData);

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

  // (Re-)arm the watchdog. Call whenever a transcript message carrying NEW
  // words arrives (interim or mid-utterance final). Critically, do NOT arm
  // on empty-transcript / no-new-word messages — those are exactly the
  // useless chunk boundaries we want the watchdog to time out past.
  const armWatchdog = useCallback(() => {
    if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    watchdogTimerRef.current = setTimeout(fireWatchdog, INACTIVITY_WATCHDOG_MS);
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

  const start = () => {
    isIntentionalStop.current = false;
    isUserStarted.current = true;
    if (debugRef.current) {
      logSttAdapterStart({
        connState: String(connectionStateRef.current),
        micState: String(microphoneState),
        path:
          connectionStateRef.current === LiveConnectionState.OPEN
            ? 'startMic-direct'
            : 'setupMic-async',
      });
    }
    if (connectionStateRef.current === LiveConnectionState.OPEN) {
      startMicrophone();
    } else if (
      microphoneState === MicrophoneState.NotSetup ||
      microphoneState === MicrophoneState.Stopped
    ) {
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
    stopMicrophone();
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

  // Warm up on mount; clear the watchdog timer on unmount so a late
  // fire can't setState on an unmounted component.
  useEffect(() => {
    setupMicrophone();
    return () => {
      clearWatchdog();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect to Deepgram once microphone is ready
  useEffect(() => {
    if (microphoneState === MicrophoneState.Ready) connectToDeepgram(DEEPGRAM_OPTIONS);
  }, [microphoneState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start microphone once connection opens (if user has called start())
  useEffect(() => {
    if (connectionState === LiveConnectionState.OPEN && isUserStarted.current) startMicrophone();
  }, [connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fast reconnect on unexpected disconnect
  useEffect(() => {
    if (
      connectionState === LiveConnectionState.CLOSED &&
      prevConnectionState.current === LiveConnectionState.OPEN &&
      !isIntentionalStop.current
    ) {
      reconnectAttempts.current = 0;
      connectToDeepgram(DEEPGRAM_OPTIONS);
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
      reconnectTimer.current = setTimeout(() => connectToDeepgram(DEEPGRAM_OPTIONS), delay);
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
