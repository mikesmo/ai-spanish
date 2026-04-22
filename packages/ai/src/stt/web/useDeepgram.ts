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

  // #region agent log
  const blobStatsRef = useRef({ sent: 0, droppedClosed: 0, droppedEmpty: 0, firstSentAt: 0 as number | 0, firstDroppedAt: 0 as number | 0 });
  // #endregion

  const sendVoiceData = useCallback((e: BlobEvent) => {
    if (connectionRef.current && connectionStateRef.current === LiveConnectionState.OPEN && e.data.size > 0) {
      try { connectionRef.current.send(e.data); } catch {}
      // #region agent log
      const s = blobStatsRef.current;
      s.sent++;
      if (s.firstSentAt === 0) {
        s.firstSentAt = Date.now();
        fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'86d2f5'},body:JSON.stringify({sessionId:'86d2f5',hypothesisId:'H1b',location:'useDeepgram.ts:sendVoiceData',message:'FIRST blob sent to Deepgram',data:{droppedBeforeFirstSent:s.droppedClosed,firstDroppedAt:s.firstDroppedAt||null,blobSize:e.data.size},timestamp:s.firstSentAt})}).catch(()=>{});
      }
      // #endregion
    } else {
      // #region agent log
      const s = blobStatsRef.current;
      if (e.data.size === 0) {
        s.droppedEmpty++;
      } else {
        s.droppedClosed++;
        if (s.firstDroppedAt === 0) {
          s.firstDroppedAt = Date.now();
          fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'86d2f5'},body:JSON.stringify({sessionId:'86d2f5',hypothesisId:'H1b',location:'useDeepgram.ts:sendVoiceData',message:'FIRST blob dropped (conn not OPEN)',data:{connState:connectionStateRef.current,hasConnRef:!!connectionRef.current,blobSize:e.data.size},timestamp:s.firstDroppedAt})}).catch(()=>{});
        }
      }
      // #endregion
    }
  }, []);

  // #region agent log
  useEffect(() => {
    if (connectionState === LiveConnectionState.OPEN) {
      blobStatsRef.current = { sent: 0, droppedClosed: 0, droppedEmpty: 0, firstSentAt: 0, firstDroppedAt: 0 };
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'86d2f5'},body:JSON.stringify({sessionId:'86d2f5',hypothesisId:'H1b',location:'useDeepgram.ts:connectionOpen',message:'Deepgram WebSocket OPEN',data:{},timestamp:Date.now()})}).catch(()=>{});
    } else if (connectionState === LiveConnectionState.CLOSED) {
      const s = blobStatsRef.current;
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'86d2f5'},body:JSON.stringify({sessionId:'86d2f5',hypothesisId:'H1b',location:'useDeepgram.ts:connectionClose',message:'Deepgram WebSocket CLOSED',data:{sent:s.sent,droppedClosed:s.droppedClosed,droppedEmpty:s.droppedEmpty},timestamp:Date.now()})}).catch(()=>{});
    }
  }, [connectionState]);
  // #endregion

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
