import { useState, useRef, useCallback, useEffect } from 'react';
import { useDeepgramConnection, LiveConnectionState } from './web/useDeepgram';
import { useMicrophone, MicrophoneState } from './web/useMicrophone';
import type { SpeechToTextHandle, SpokenWord } from '@ai-spanish/logic';
import {
  getDefaultLearningPipelineDebug,
  logSttClear,
  logSttSegment,
  logSttUtteranceEnd,
} from '@ai-spanish/logic';

const DEEPGRAM_OPTIONS = {
  model: 'nova-2',
  interim_results: true,
  smart_format: true,
  filler_words: true,
  // utterance_end_ms: how long of total silence before declaring the whole
  // utterance over (client gets a synthetic empty-final). Raised so learners
  // who pause mid-phrase still get a chance to emit the second word.
  // Deepgram's documented max is 5000 ms; values above cause the WebSocket
  // upgrade to be refused (NS_ERROR_WEBSOCKET_CONNECTION_REFUSED).
  // See: https://developers.deepgram.com/docs/utterance-end
  utterance_end_ms: 5000,
  // endpointing: how long of silence before committing the current words as
  // is_final=true. Lowered so each word-group is finalized eagerly, leaving
  // Deepgram free to start a fresh segment for the next word (e.g. "algo"
  // after "quieres ... <pause>").
  endpointing: 500,
  language: 'es',
} as const;

export function useSTT(): SpeechToTextHandle {
  const {
    connectionState,
    connectionStateRef,
    connectionFailedSignal,
    onTranscriptRef,
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

  const start = () => {
    isIntentionalStop.current = false;
    isUserStarted.current = true;
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
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    reconnectAttempts.current = 0;
    stopMicrophone();
    await disconnectFromDeepgram();
  };

  const debugRef = useRef(getDefaultLearningPipelineDebug());
  debugRef.current = getDefaultLearningPipelineDebug();

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
  };

  // Warm up on mount
  useEffect(() => { setupMicrophone(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Wire up transcript callback
  onTranscriptRef.current = useCallback((data: unknown) => {
    const d = data as {
      is_final?: boolean;
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
    const dataIsFinal = d?.is_final ?? false;
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
      if (dataIsFinal) {
        paragraphRef.current = lastCaptionRef.current;
        setIsFinal(true);
        if (debugRef.current) {
          logSttUtteranceEnd({
            totalFinalized: finalizedWordsRef.current.length,
            caption: lastCaptionRef.current,
          });
        }
      }
      return;
    }

    const newCaption = (paragraphRef.current + ' ' + transcript).trim();
    lastCaptionRef.current = newCaption;
    setCaption(newCaption);

    // Words arrive per segment; on final we append to finalized, on interim we
    // show finalized + current interim segment so `words` mirrors `caption`.
    let totalWords: number;
    if (dataIsFinal) {
      finalizedWordsRef.current = [...finalizedWordsRef.current, ...segmentWords];
      setWords(finalizedWordsRef.current);
      paragraphRef.current = newCaption;
      setIsFinal(true);
      totalWords = finalizedWordsRef.current.length;
    } else {
      const merged = [...finalizedWordsRef.current, ...segmentWords];
      setWords(merged);
      setIsFinal(false);
      totalWords = merged.length;
    }

    if (debugRef.current) {
      logSttSegment({
        isFinal: dataIsFinal,
        segmentWords: segmentWords.length,
        totalFinalized: finalizedWordsRef.current.length,
        totalWords,
        transcript,
        captionLen: newCaption.length,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
