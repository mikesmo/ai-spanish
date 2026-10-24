import { useCallback, useEffect, useRef, useState } from 'react';
import { prefetchListenKey, resolveKeyForListen } from './deepgramAuthKey.native';
import {
  bumpSttEpoch,
  createSttAudioRingBuffer,
  getDefaultLearningPipelineDebug,
  isCurrentSttEpoch,
  logSttAdapterStart,
  logSttAdapterStop,
  logSttClear,
  logSttSegment,
  logSttStartupTimeline,
  logSttUtteranceEnd,
  reduceAcceptGate,
  selectSttStartPath,
  toDeepgramLiveKeywordParams,
  type SpeechToTextHandle,
  type SpokenWord,
  type SttPrewarmOptions,
  type SttStartOptions,
  type SttStartupPath,
  type SttStartupTimeline,
} from '@ai-spanish/logic';
import {
  spokenWordsFromDeepgramRaw,
  syntheticSpokenWordsFromTextSegment,
} from './deepgramSpokenWords';
import { useDeepgramLiveSocket } from './native/useDeepgramLiveSocket';
import {
  NativeMicStartError,
  useNativeMicrophone,
} from './native/useNativeMicrophone';
import {
  createSdkTranscriptShim,
  transcriptFromDeepgramListenMessage,
} from './native/sdkTranscriptShim';

/**
 * Deepgram live options — mirrors the web adapter so both platforms
 * transcribe with the same behaviour. See historical notes in git history:
 * endpointing 1500, no utterance_end_ms, nova-2, es-ES.
 */
const DEFAULT_LANGUAGE = 'es-ES';

const INACTIVITY_WATCHDOG_MS = 5000;
const INITIAL_SILENCE_TIMEOUT_MS = 8000;
const IS_FINAL_COMMIT_DEBOUNCE_MS = 800;
const ZERO_CHUNK_RETRY_MS = 1000;

interface UseSttOptions {
  language?: string;
}

function createEmptyTimeline(path: SttStartupPath): SttStartupTimeline {
  return {
    t0: Date.now(),
    path,
    micLiveMs: null,
    wsOpenMs: null,
    firstChunkMs: null,
    audioChunkCount: 0,
    firstTranscriptMs: null,
    bufferedChunksFlushed: 0,
    clearToGateReopenMs: null,
  };
}

export function useSTT(hookOptions?: UseSttOptions): SpeechToTextHandle {
  const language = hookOptions?.language ?? DEFAULT_LANGUAGE;
  const [caption, setCaption] = useState('');
  const [isFinal, setIsFinalState] = useState(false);
  const [words, setWords] = useState<SpokenWord[]>([]);
  const [sttError, setSttError] = useState<string | null>(null);
  const paragraphRef = useRef('');
  const lastCaptionRef = useRef('');
  const finalizedCountRef = useRef(0);
  const finalizedWordsRef = useRef<SpokenWord[]>([]);
  const pendingInterimWordsRef = useRef<SpokenWord[]>([]);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const finalCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zeroChunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startEpochRef = useRef(0);
  const acceptingTranscriptsRef = useRef(false);
  const stopInFlightRef = useRef<Promise<void> | null>(null);
  const debugRef = useRef(getDefaultLearningPipelineDebug());
  debugRef.current = getDefaultLearningPipelineDebug();
  const nextKeywordsRef = useRef<string[]>([]);
  const clearStartedAtRef = useRef<number | null>(null);
  const timelineRef = useRef<SttStartupTimeline>(createEmptyTimeline('cold'));
  const ringBufferRef = useRef(
    createSttAudioRingBuffer<ArrayBuffer>((c) => c.byteLength),
  );

  const stopMicRef = useRef<() => Promise<void>>(async () => {});
  const emitTimeline = useCallback(() => {
    logSttStartupTimeline({ ...timelineRef.current });
  }, []);

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

  const clearZeroChunkTimer = useCallback(() => {
    if (zeroChunkTimerRef.current) {
      clearTimeout(zeroChunkTimerRef.current);
      zeroChunkTimerRef.current = null;
    }
  }, []);

  const handleTranscript = useCallback(
    (text: string, event?: { isFinal?: boolean; raw?: unknown }) => {
      if (timelineRef.current.firstTranscriptMs === null && text !== '') {
        timelineRef.current.firstTranscriptMs =
          Date.now() - timelineRef.current.t0;
        emitTimeline();
      }
      if (text !== '') clearInitialSilenceTimer();
      const raw = event?.raw;

      const runDebouncedCommit = (
        segmentWordCount: number,
        transcriptLine: string,
      ) => {
        clearFinalCommitTimer();
        const myEpoch = startEpochRef.current;
        finalCommitTimerRef.current = setTimeout(() => {
          finalCommitTimerRef.current = null;
          if (startEpochRef.current !== myEpoch) return;
          paragraphRef.current = lastCaptionRef.current;
          finalizedCountRef.current += 1;
          setIsFinalState(true);
          clearInactivityTimer();
          acceptingTranscriptsRef.current = false;
          void stopMicRef.current();
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
          const pending = pendingInterimWordsRef.current;
          if (pending.length > 0) {
            finalizedWordsRef.current = [
              ...finalizedWordsRef.current,
              ...pending,
            ];
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
        clearInactivityTimer();
        inactivityTimerRef.current = setTimeout(() => {
          inactivityTimerRef.current = null;
          clearFinalCommitTimer();
          const pending = pendingInterimWordsRef.current;
          if (pending.length > 0) {
            finalizedWordsRef.current = [
              ...finalizedWordsRef.current,
              ...pending,
            ];
            pendingInterimWordsRef.current = [];
            setWords([...finalizedWordsRef.current]);
          }
          paragraphRef.current = lastCaptionRef.current;
          setIsFinalState(true);
          finalizedCountRef.current += 1;
          acceptingTranscriptsRef.current = false;
          void stopMicRef.current();
          if (debugRef.current) {
            logSttUtteranceEnd({
              totalFinalized: finalizedCountRef.current,
              caption: lastCaptionRef.current,
              trigger: 'inactivity-watchdog',
            });
          }
        }, INACTIVITY_WATCHDOG_MS);
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
    [clearFinalCommitTimer, clearInactivityTimer, clearInitialSilenceTimer, emitTimeline],
  );

  const handleTranscriptRef = useRef(handleTranscript);
  handleTranscriptRef.current = handleTranscript;
  const shimRef = useRef(
    createSdkTranscriptShim((text, event) => {
      handleTranscriptRef.current(text, event);
    }),
  );

  const applyGateAndEmit = useCallback(
    (raw: unknown) => {
      const parsed = transcriptFromDeepgramListenMessage(raw);
      const gate = reduceAcceptGate(
        { accepting: acceptingTranscriptsRef.current },
        {
          type: 'transcript',
          isFinal: parsed.isFinal,
          fromFinalize: parsed.fromFinalize,
        },
      );
      acceptingTranscriptsRef.current = gate.accepting;
      if (parsed.fromFinalize || (clearStartedAtRef.current !== null && gate.accepting)) {
        if (clearStartedAtRef.current !== null && gate.accepting) {
          timelineRef.current.clearToGateReopenMs =
            Date.now() - clearStartedAtRef.current;
          timelineRef.current.finalizeFlushPayload = raw;
          clearStartedAtRef.current = null;
          emitTimeline();
        }
      }
      if (!gate.acceptEvent) return;
      shimRef.current.emit(parsed.transcript, parsed.isFinalCollapsed, raw);
    },
    [emitTimeline],
  );

  const flushBufferToSocket = useCallback(
    (sendAudio: (chunk: ArrayBuffer) => void) => {
      const flushed = ringBufferRef.current.flush();
      timelineRef.current.bufferedChunksFlushed += flushed.length;
      for (const chunk of flushed) {
        sendAudio(chunk);
      }
      if (flushed.length > 0) emitTimeline();
    },
    [emitTimeline],
  );

  const socket = useDeepgramLiveSocket({
    onMessage: applyGateAndEmit,
    onOpen: () => {
      timelineRef.current.wsOpenMs = Date.now() - timelineRef.current.t0;
      emitTimeline();
    },
    onError: (err) => {
      const message =
        err instanceof Error
          ? err.message
          : 'Speech recognition could not connect. Check your network and try again.';
      setSttError(message);
    },
  });

  const sendAudioRef = useRef(socket.sendAudio);
  sendAudioRef.current = socket.sendAudio;
  const connectionStateRef = socket.connectionStateRef;

  const handlePcm = useCallback((chunk: ArrayBuffer) => {
    if (timelineRef.current.firstChunkMs === null) {
      timelineRef.current.firstChunkMs = Date.now() - timelineRef.current.t0;
    }
    timelineRef.current.audioChunkCount += 1;
    if (connectionStateRef.current === 'open') {
      sendAudioRef.current(chunk);
    } else {
      ringBufferRef.current.push(chunk);
    }
  }, [connectionStateRef]);

  const mic = useNativeMicrophone(handlePcm);
  stopMicRef.current = mic.stop;

  useEffect(() => {
    if (socket.connectionState === 'open') {
      flushBufferToSocket(socket.sendAudio);
    }
  }, [flushBufferToSocket, socket.connectionState, socket.sendAudio]);

  const armInitialSilence = useCallback(
    (myEpoch: number) => {
      clearInitialSilenceTimer();
      initialSilenceTimerRef.current = setTimeout(() => {
        initialSilenceTimerRef.current = null;
        if (startEpochRef.current !== myEpoch) return;
        const pending = pendingInterimWordsRef.current;
        if (pending.length > 0) {
          finalizedWordsRef.current = [
            ...finalizedWordsRef.current,
            ...pending,
          ];
          pendingInterimWordsRef.current = [];
          setWords([...finalizedWordsRef.current]);
        }
        setIsFinalState(true);
        acceptingTranscriptsRef.current = false;
        void mic.stop();
        if (debugRef.current) {
          logSttUtteranceEnd({
            totalFinalized: finalizedCountRef.current,
            caption: lastCaptionRef.current,
            trigger: 'initial-silence-timeout',
          });
        }
      }, INITIAL_SILENCE_TIMEOUT_MS);
    },
    [clearInitialSilenceTimer, mic],
  );

  const connectWithKey = useCallback(
    async (keywords: string[], signal?: AbortSignal): Promise<void> => {
      const apiKey = await resolveKeyForListen();
      if (signal?.aborted) return;
      await socket.connect({
        apiKey,
        language,
        keywords,
        signal,
      });
    },
    [language, socket],
  );

  const startMicWithRetry = useCallback(
    async (myEpoch: number): Promise<boolean> => {
      const tryOnce = async (): Promise<boolean> => {
        mic.resetChunkCount();
        try {
          await mic.start();
        } catch (err) {
          if (err instanceof NativeMicStartError && err.code === 'permission_denied') {
            setSttError('Microphone permission denied.');
            return false;
          }
          throw err;
        }
        if (!isCurrentSttEpoch(startEpochRef.current, myEpoch)) {
          await mic.stop();
          return false;
        }
        timelineRef.current.micLiveMs = Date.now() - timelineRef.current.t0;
        emitTimeline();
        return true;
      };

      try {
        if (!(await tryOnce())) return false;
      } catch {
        await new Promise<void>((r) => setTimeout(r, 50));
        if (!isCurrentSttEpoch(startEpochRef.current, myEpoch)) return false;
        try {
          if (!(await tryOnce())) return false;
        } catch {
          setSttError(
            'Speech recognition could not start the microphone. Try again.',
          );
          return false;
        }
      }

      clearZeroChunkTimer();
      const startedAtCount = timelineRef.current.audioChunkCount;
      zeroChunkTimerRef.current = setTimeout(() => {
        zeroChunkTimerRef.current = null;
        if (!isCurrentSttEpoch(startEpochRef.current, myEpoch)) return;
        if (timelineRef.current.audioChunkCount > startedAtCount) return;
        void (async () => {
          await mic.stop();
          if (!isCurrentSttEpoch(startEpochRef.current, myEpoch)) return;
          try {
            await mic.start();
            timelineRef.current.micLiveMs = Date.now() - timelineRef.current.t0;
            emitTimeline();
          } catch {
            setSttError(
              'Speech recognition could not start the microphone. Try again.',
            );
          }
        })();
      }, ZERO_CHUNK_RETRY_MS);
      return true;
    },
    [clearZeroChunkTimer, emitTimeline, mic],
  );

  const resetCaptionState = useCallback(() => {
    setCaption('');
    setIsFinalState(false);
    finalizedWordsRef.current = [];
    pendingInterimWordsRef.current = [];
    setWords([]);
    paragraphRef.current = '';
    lastCaptionRef.current = '';
    finalizedCountRef.current = 0;
    shimRef.current.reset();
    clearInactivityTimer();
    clearInitialSilenceTimer();
    clearFinalCommitTimer();
  }, [clearFinalCommitTimer, clearInactivityTimer, clearInitialSilenceTimer]);

  const clearTranscription = useCallback(() => {
    const prevCaptionLen = lastCaptionRef.current.length;
    const prevFinalized = finalizedCountRef.current;
    const gate = reduceAcceptGate(
      { accepting: acceptingTranscriptsRef.current },
      { type: 'close' },
    );
    acceptingTranscriptsRef.current = gate.accepting;
    resetCaptionState();
    clearStartedAtRef.current = Date.now();
    timelineRef.current.path = 'clear';
    socket.finalize();
    if (debugRef.current) {
      logSttClear({ prevFinalized, prevCaptionLen });
    }
  }, [resetCaptionState, socket]);

  const prewarm = useCallback(
    (options?: SttPrewarmOptions) => {
      if (options?.signal?.aborted) return;
      const keywords = options?.keywords ?? [];
      nextKeywordsRef.current = keywords;
      void (async () => {
        try {
          prefetchListenKey();
          const path = selectSttStartPath({
            connectionState: socket.connectionStateRef.current,
            connectedKeywords: socket.connectedKeywordsRef.current,
            requestedKeywords: keywords,
          });
          if (path === 'warm') return;
          await connectWithKey(keywords, options?.signal);
        } catch (err) {
          console.error('[Deepgram STT] prewarm', err);
        }
      })();
    },
    [connectWithKey, socket],
  );

  const start = useCallback(
    (options?: SttStartOptions) => {
      if (options?.signal?.aborted) return;
      setSttError(null);
      const keywords =
        options?.keywords && options.keywords.length > 0
          ? toDeepgramLiveKeywordParams(options.keywords)
          : [];
      nextKeywordsRef.current = keywords;

      if (mic.isLive) {
        if (debugRef.current) {
          logSttAdapterStart({
            connState: socket.connectionStateRef.current,
            micState: 'live',
            path: 'startMic-direct',
            keywords: options?.keywords,
          });
        }
        armInitialSilence(startEpochRef.current);
        return;
      }

      startEpochRef.current = bumpSttEpoch(startEpochRef.current);
      const myEpoch = startEpochRef.current;
      const machinePath = selectSttStartPath({
        connectionState: socket.connectionStateRef.current,
        connectedKeywords: socket.connectedKeywordsRef.current,
        requestedKeywords: keywords,
      });
      const logPath: SttStartupPath =
        machinePath === 'warm'
          ? 'warm'
          : machinePath === 'keyword-mismatch'
            ? 'connect'
            : 'connect';
      timelineRef.current = createEmptyTimeline(logPath);
      ringBufferRef.current.clear();

      if (debugRef.current) {
        logSttAdapterStart({
          connState: socket.connectionStateRef.current,
          micState: 'idle',
          path: machinePath === 'warm' ? 'startMic-direct' : 'connect-direct',
          keywords: options?.keywords,
        });
      }

      void (async () => {
        if (machinePath === 'keyword-mismatch') {
          socket.disconnect();
        }
        if (
          machinePath !== 'warm' &&
          socket.connectionStateRef.current !== 'connecting'
        ) {
          void connectWithKey(keywords, options?.signal).catch((err: unknown) => {
            if (!isCurrentSttEpoch(startEpochRef.current, myEpoch)) return;
            console.error('[Deepgram STT] connect', err);
            setSttError(
              err instanceof Error
                ? err.message
                : 'Speech recognition could not connect. Check your network and try again.',
            );
          });
        }
        const started = await startMicWithRetry(myEpoch);
        if (!started || !isCurrentSttEpoch(startEpochRef.current, myEpoch)) {
          return;
        }
        if (options?.signal?.aborted) {
          await mic.stop();
          return;
        }
        const opened = reduceAcceptGate(
          { accepting: acceptingTranscriptsRef.current },
          { type: 'openAfterStoppedMic' },
        );
        acceptingTranscriptsRef.current = opened.accepting;
        armInitialSilence(myEpoch);
      })();
    },
    [armInitialSilence, connectWithKey, mic, socket, startMicWithRetry],
  );

  const runStop = useCallback(async () => {
    startEpochRef.current = bumpSttEpoch(startEpochRef.current);
    acceptingTranscriptsRef.current = false;
    clearInactivityTimer();
    clearInitialSilenceTimer();
    clearFinalCommitTimer();
    clearZeroChunkTimer();
    if (debugRef.current) {
      logSttAdapterStop({
        connState: socket.connectionStateRef.current,
        micState: mic.isLive ? 'live' : 'idle',
      });
    }
    await mic.stop();
    socket.finalize();
  }, [
    clearFinalCommitTimer,
    clearInactivityTimer,
    clearInitialSilenceTimer,
    clearZeroChunkTimer,
    mic,
    socket,
  ]);

  useEffect(() => {
    return () => {
      startEpochRef.current = bumpSttEpoch(startEpochRef.current);
      void mic.stop();
      socket.disconnect();
    };
    // Unmount-only teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    start,
    prewarm,
    stop: (): void | Promise<void> => {
      if (!stopInFlightRef.current) {
        stopInFlightRef.current = runStop().finally(() => {
          stopInFlightRef.current = null;
        });
      }
      return stopInFlightRef.current;
    },
    isRecording: mic.isLive,
    caption,
    words,
    isFinal,
    clearTranscription,
    error: sttError,
  };
}
