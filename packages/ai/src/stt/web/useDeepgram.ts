"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  createClient,
  LiveClient,
  LiveConnectionState,
  LiveTranscriptionEvents,
  type LiveSchema,
} from "@deepgram/sdk";

export { LiveConnectionState };

export function useDeepgramConnection() {
  const [connectionState, setConnectionState] = useState<LiveConnectionState>(LiveConnectionState.CLOSED);
  const onTranscriptRef = useRef<((data: unknown) => void) | null>(null);
  const transcriptHandlerRef = useRef<((data: unknown) => void) | null>(null);
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

  const sendVoiceData = useCallback((e: BlobEvent) => {
    if (connectionRef.current && connectionStateRef.current === LiveConnectionState.OPEN && e.data.size > 0) {
      try { connectionRef.current.send(e.data); } catch {}
    }
  }, []);

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
    connectToDeepgram,
    disconnectFromDeepgram,
    sendVoiceData,
  };
}
