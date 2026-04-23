"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  createClient,
  LiveClient,
  LiveConnectionState,
  LiveTranscriptionEvents,
  type LiveSchema,
} from "@deepgram/sdk";
import {
  getDefaultLearningPipelineDebug,
  logSttDeepgramClose,
  logSttDeepgramFirstBlobDropped,
  logSttDeepgramFirstBlobSent,
  logSttDeepgramOpen,
} from "@ai-spanish/logic";

export { LiveConnectionState };

export function useDeepgramConnection() {
  const [connectionState, setConnectionState] = useState<LiveConnectionState>(LiveConnectionState.CLOSED);
  const onTranscriptRef = useRef<((data: unknown) => void) | null>(null);
  const onUtteranceEndRef = useRef<((data: unknown) => void) | null>(null);
  const transcriptHandlerRef = useRef<((data: unknown) => void) | null>(null);
  const utteranceEndHandlerRef = useRef<((data: unknown) => void) | null>(null);
  const keepAliveIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>();
  const connectionRef = useRef<LiveClient | null>(null);
  const connectionStateRef = useRef<LiveConnectionState>(LiveConnectionState.CLOSED);
  const nextApiKeyRef = useRef<{ key: string; fetchedAt: number } | null>(null);
  const [connectionFailedSignal, setConnectionFailedSignal] = useState(0);
  const connectionIdRef = useRef(0);

  const getApiKey = async (): Promise<string> => {
    const response = await fetch("/api/authenticate", { cache: "no-store" });
    const result = await response.json();
    if (!result.key) throw new Error("API returned empty or missing key");
    return result.key;
  };

  const prefetchApiKey = useCallback(async () => {
    try {
      const response = await fetch("/api/authenticate", { cache: "no-store" });
      const result = await response.json();
      if (!result.key) return;
      nextApiKeyRef.current = { key: result.key, fetchedAt: Date.now() };
    } catch (err) {
      console.error("Failed to pre-fetch API key:", err);
    }
  }, []);

  const stopKeepAlive = () => {
    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = undefined;
    }
  };

  const startKeepAlive = (conn: LiveClient) => {
    stopKeepAlive();
    conn.keepAlive();
    keepAliveIntervalRef.current = setInterval(() => {
      try {
        if (conn.getReadyState() === 1) conn.keepAlive(); // 1 = WebSocket OPEN
        else stopKeepAlive();
      } catch {}
    }, 1000);
  };

  const connectToDeepgram = useCallback(async (options: LiveSchema) => {
    connectionIdRef.current++;
    const id = connectionIdRef.current;
    try {
      let key: string;
      const cached = nextApiKeyRef.current;
      if (cached && Date.now() - cached.fetchedAt < 45_000) {
        key = cached.key;
        nextApiKeyRef.current = null;
      } else {
        nextApiKeyRef.current = null;
        key = await getApiKey();
      }

      const conn = createClient(key).listen.live({
        ...options,
        client_id: `conn-${id}-${Date.now()}`,
      });

      let opened = false;

      conn.addListener(LiveTranscriptionEvents.Open, () => {
        opened = true;
        connectionRef.current = conn;
        connectionStateRef.current = LiveConnectionState.OPEN;
        setConnectionState(LiveConnectionState.OPEN);
        startKeepAlive(conn);
        prefetchApiKey();
      });

      conn.addListener(LiveTranscriptionEvents.Close, () => {
        stopKeepAlive();
        connectionStateRef.current = LiveConnectionState.CLOSED;
        setConnectionState(LiveConnectionState.CLOSED);
        if (!opened) setConnectionFailedSignal((n) => n + 1);
      });

      conn.addListener(LiveTranscriptionEvents.Error, (err) =>
        console.error(`[Deepgram connection ${id}] error:`, err)
      );

      const handler = (data: unknown) => onTranscriptRef.current?.(data);
      conn.addListener(LiveTranscriptionEvents.Transcript, handler);
      transcriptHandlerRef.current = handler;

      // UtteranceEnd is a separate event type from Transcript. Deepgram emits
      // it when `utterance_end_ms` of silence elapses without endpointing
      // firing speech_final=true, giving us a safety-net utterance closer.
      const utteranceEndHandler = (data: unknown) =>
        onUtteranceEndRef.current?.(data);
      conn.addListener(LiveTranscriptionEvents.UtteranceEnd, utteranceEndHandler);
      utteranceEndHandlerRef.current = utteranceEndHandler;

      connectionRef.current = conn;
    } catch (err) {
      console.error(`[Deepgram connection ${id}] failed to create:`, err);
      connectionStateRef.current = LiveConnectionState.CLOSED;
      setConnectionState(LiveConnectionState.CLOSED);
      setConnectionFailedSignal((n) => n + 1);
    }
  }, [prefetchApiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnectFromDeepgram = useCallback(async () => {
    if (connectionRef.current) {
      try {
        stopKeepAlive();
        connectionStateRef.current = LiveConnectionState.CLOSING;
        if (transcriptHandlerRef.current) {
          connectionRef.current.removeListener(
            LiveTranscriptionEvents.Transcript,
            transcriptHandlerRef.current
          );
        }
        if (utteranceEndHandlerRef.current) {
          connectionRef.current.removeListener(
            LiveTranscriptionEvents.UtteranceEnd,
            utteranceEndHandlerRef.current
          );
        }
        connectionRef.current.finish();
        await new Promise((r) => setTimeout(r, 100));
        connectionRef.current.removeAllListeners();
        connectionRef.current = null;
        connectionStateRef.current = LiveConnectionState.CLOSED;
        setConnectionState(LiveConnectionState.CLOSED);
      } catch (err) {
        console.error("[Deepgram] disconnect error:", err);
      }
    }
  }, []);

  const blobStatsRef = useRef({
    sent: 0,
    droppedClosed: 0,
    droppedEmpty: 0,
    firstSentAt: 0 as number | 0,
    firstDroppedAt: 0 as number | 0,
  });

  const sendVoiceData = useCallback((e: BlobEvent) => {
    if (connectionRef.current && connectionStateRef.current === LiveConnectionState.OPEN && e.data.size > 0) {
      try { connectionRef.current.send(e.data); } catch {}
      const s = blobStatsRef.current;
      s.sent++;
      if (s.firstSentAt === 0) {
        s.firstSentAt = Date.now();
        if (getDefaultLearningPipelineDebug()) {
          logSttDeepgramFirstBlobSent({
            droppedBeforeFirstSent: s.droppedClosed,
            firstDroppedAt: s.firstDroppedAt || null,
            blobSize: e.data.size,
          });
        }
      }
    } else {
      const s = blobStatsRef.current;
      if (e.data.size === 0) {
        s.droppedEmpty++;
      } else {
        s.droppedClosed++;
        if (s.firstDroppedAt === 0) {
          s.firstDroppedAt = Date.now();
          if (getDefaultLearningPipelineDebug()) {
            logSttDeepgramFirstBlobDropped({
              connState: String(connectionStateRef.current),
              hasConnRef: !!connectionRef.current,
              blobSize: e.data.size,
            });
          }
        }
      }
    }
  }, []);

  useEffect(() => {
    if (connectionState === LiveConnectionState.OPEN) {
      blobStatsRef.current = {
        sent: 0,
        droppedClosed: 0,
        droppedEmpty: 0,
        firstSentAt: 0,
        firstDroppedAt: 0,
      };
      if (getDefaultLearningPipelineDebug()) {
        logSttDeepgramOpen();
      }
    } else if (connectionState === LiveConnectionState.CLOSED) {
      const s = blobStatsRef.current;
      if (getDefaultLearningPipelineDebug()) {
        logSttDeepgramClose({
          sent: s.sent,
          droppedClosed: s.droppedClosed,
          droppedEmpty: s.droppedEmpty,
        });
      }
    }
  }, [connectionState]);

  useEffect(() => {
    return () => {
      stopKeepAlive();
      connectionRef.current?.removeAllListeners();
      connectionRef.current?.finish();
    };
  }, []);

  return {
    connectionState,
    connectionStateRef,
    connectionFailedSignal,
    onTranscriptRef,
    onUtteranceEndRef,
    connectToDeepgram,
    disconnectFromDeepgram,
    sendVoiceData,
  };
}
