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
  // The most recent interim segment's words. Deepgram sends interim results
  // containing the full current utterance-so-far (each interim replaces the
  // prior). When a synthetic `utterance_end` (transcript='', is_final=true)
  // arrives *without* a matching real is_final=true for the pending interim,
  // we need to salvage these words so `stt.words` stays aligned with
  // `stt.caption` (which *is* committed via paragraphRef). Without this,
  // downstream alignment runs on a subset of what the UI shows.
  const pendingInterimWordsRef = useRef<SpokenWord[]>([]);

  const start = () => {
    isIntentionalStop.current = false;
    isUserStarted.current = true;
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'86d2f5'},body:JSON.stringify({sessionId:'86d2f5',hypothesisId:'H1b',location:'stt/index.web.ts:start',message:'stt.start() called',data:{connState:connectionStateRef.current,micState:microphoneState,path:connectionStateRef.current===LiveConnectionState.OPEN?'startMic-direct':'setupMic-async'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'86d2f5'},body:JSON.stringify({sessionId:'86d2f5',hypothesisId:'H1b',location:'stt/index.web.ts:stop',message:'stt.stop() called (disconnects WebSocket)',data:{connState:connectionStateRef.current,micState:microphoneState},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f8262d'},body:JSON.stringify({sessionId:'f8262d',hypothesisId:'H2',location:'stt/index.web.ts:clearTranscription',message:'STT clearTranscription',data:{prevCaptionLen:lastCaptionRef.current.length,prevFinalized:finalizedWordsRef.current.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setCaption('');
    setIsFinal(false);
    setWords([]);
    paragraphRef.current = '';
    lastCaptionRef.current = '';
    finalizedWordsRef.current = [];
    pendingInterimWordsRef.current = [];
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
        // Salvage any pending interim words. Deepgram's synthetic
        // empty-final marks the utterance as closed without having finalized
        // the latest interim segment, which would otherwise orphan those
        // words: a subsequent interim segment rebuilds `words` as
        // `finalizedWordsRef + newSegment`, dropping the pending ones.
        const pending = pendingInterimWordsRef.current;
        const salvagedCount = pending.length;
        if (salvagedCount > 0) {
          finalizedWordsRef.current = [
            ...finalizedWordsRef.current,
            ...pending,
          ];
          setWords(finalizedWordsRef.current);
          pendingInterimWordsRef.current = [];
        }
        paragraphRef.current = lastCaptionRef.current;
        setIsFinal(true);
        if (debugRef.current) {
          logSttUtteranceEnd({
            totalFinalized: finalizedWordsRef.current.length,
            caption: lastCaptionRef.current,
            pendingInterimWords: salvagedCount,
            salvagedInterimWords: salvagedCount,
          });
        }
      }
      return;
    }

    const newCaption = (paragraphRef.current + ' ' + transcript).trim();
    // #region agent log
    if (transcript.length > 0) {
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f8262d'},body:JSON.stringify({sessionId:'f8262d',hypothesisId:'H2',location:'stt/index.web.ts:Transcript:segment',message:'STT segment merged into caption',data:{paraBefore:paragraphRef.current.slice(0,200),transcript:transcript.slice(0,200),newCaption:newCaption.slice(0,400),dataIsFinal,segWords:segmentWords.length},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
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
      pendingInterimWordsRef.current = [];
    } else {
      pendingInterimWordsRef.current = segmentWords;
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
