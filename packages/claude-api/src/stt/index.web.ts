import { useState, useRef, useCallback, useEffect } from 'react';
import { useDeepgramConnection, LiveConnectionState } from './web/useDeepgram';
import { useMicrophone, MicrophoneState } from './web/useMicrophone';
import type { SpeechToTextHandle } from '@ai-spanish/logic';

const DEEPGRAM_OPTIONS = {
  model: 'nova-2',
  interim_results: true,
  smart_format: true,
  filler_words: true,
  utterance_end_ms: 3000,
  endpointing: 1000,
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
  const paragraphRef = useRef('');
  const lastCaptionRef = useRef('');

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

  const clearTranscription = () => {
    setCaption('');
    setIsFinal(false);
    paragraphRef.current = '';
    lastCaptionRef.current = '';
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
    const d = data as { is_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
    const transcript = d?.channel?.alternatives?.[0]?.transcript ?? '';
    const dataIsFinal = d?.is_final ?? false;

    if (transcript === '') {
      if (dataIsFinal) { paragraphRef.current = lastCaptionRef.current; setIsFinal(true); }
      return;
    }
    const newCaption = (paragraphRef.current + ' ' + transcript).trim();
    lastCaptionRef.current = newCaption;
    setCaption(newCaption);
    if (dataIsFinal) { paragraphRef.current = newCaption; setIsFinal(true); }
    else setIsFinal(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    start,
    stop,
    isRecording: microphoneState === MicrophoneState.Open,
    caption,
    isFinal,
    clearTranscription,
  };
}
