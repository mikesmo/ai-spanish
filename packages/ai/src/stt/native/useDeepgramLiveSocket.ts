import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  logSttDeepgramKeywordsSent,
  type SttConnectionState,
} from '@ai-spanish/logic';
import { buildDeepgramListenUrl } from './deepgramListenUrl';

const KEEPALIVE_MS = 3000;
const CONNECT_TIMEOUT_MS = 10_000;

type RnWebSocket = WebSocket & {
  send: (data: string | ArrayBuffer | ArrayBufferView) => void;
};

interface RnWebSocketConstructor {
  new (
    url: string,
    protocols?: string | string[] | null,
    options?: { headers?: Record<string, string> },
  ): RnWebSocket;
}

export interface DeepgramLiveConnectOptions {
  apiKey: string;
  language: string;
  keywords?: string[];
  signal?: AbortSignal;
}

export interface UseDeepgramLiveSocketOptions {
  onMessage: (raw: unknown) => void;
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}

export function useDeepgramLiveSocket({
  onMessage,
  onOpen,
  onError,
  onClose,
}: UseDeepgramLiveSocketOptions): {
  connectionState: SttConnectionState;
  connectionStateRef: MutableRefObject<SttConnectionState>;
  connectedKeywordsRef: MutableRefObject<string[]>;
  connect: (options: DeepgramLiveConnectOptions) => Promise<void>;
  disconnect: () => void;
  finalize: () => void;
  sendAudio: (chunk: ArrayBuffer) => void;
} {
  const [connectionState, setConnectionState] =
    useState<SttConnectionState>('closed');
  const connectionStateRef = useRef<SttConnectionState>('closed');
  const connectedKeywordsRef = useRef<string[]>([]);
  const connectionIdRef = useRef(0);
  const wsRef = useRef<RnWebSocket | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stopKeepAlive = useCallback(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
  }, []);

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  const setState = useCallback((next: SttConnectionState) => {
    connectionStateRef.current = next;
    setConnectionState(next);
  }, []);

  const disconnect = useCallback(() => {
    connectionIdRef.current += 1;
    clearConnectTimer();
    stopKeepAlive();
    const ws = wsRef.current;
    wsRef.current = null;
    connectedKeywordsRef.current = [];
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close(1000, 'cleanup');
      } catch {
        /* empty */
      }
    }
    setState('closed');
  }, [clearConnectTimer, setState, stopKeepAlive]);

  const connect = useCallback(
    async (options: DeepgramLiveConnectOptions): Promise<void> => {
      const keywords = options.keywords ?? [];
      if (keywords.length > 0) {
        logSttDeepgramKeywordsSent(keywords);
      }
      connectionIdRef.current += 1;
      const myId = connectionIdRef.current;
      clearConnectTimer();
      stopKeepAlive();
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close(1000, 'replaced');
        } catch {
          /* empty */
        }
        wsRef.current = null;
      }
      if (options.signal?.aborted || connectionIdRef.current !== myId) {
        return;
      }
      setState('connecting');
      connectedKeywordsRef.current = keywords;

      const url = buildDeepgramListenUrl({
        language: options.language,
        keywords,
      });
      const WS = WebSocket as unknown as RnWebSocketConstructor;
      const ws = new WS(url, undefined, {
        headers: { Authorization: `Token ${options.apiKey}` },
      });
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        connectTimerRef.current = setTimeout(() => {
          if (connectionIdRef.current !== myId) {
            finish();
            return;
          }
          onErrorRef.current?.(
            new Error('Speech recognition could not connect. Check your network and try again.'),
          );
          try {
            ws.close();
          } catch {
            /* empty */
          }
          finish();
        }, CONNECT_TIMEOUT_MS);

        ws.onopen = () => {
          if (connectionIdRef.current !== myId) {
            try {
              ws.close();
            } catch {
              /* empty */
            }
            finish();
            return;
          }
          clearConnectTimer();
          setState('open');
          stopKeepAlive();
          keepAliveRef.current = setInterval(() => {
            try {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'KeepAlive' }));
              } else {
                stopKeepAlive();
              }
            } catch {
              stopKeepAlive();
            }
          }, KEEPALIVE_MS);
          onOpenRef.current?.();
          finish();
        };

        ws.onmessage = (ev: MessageEvent) => {
          if (connectionIdRef.current !== myId) return;
          if (typeof ev.data !== 'string') return;
          try {
            onMessageRef.current?.(JSON.parse(ev.data));
          } catch {
            /* non-JSON */
          }
        };

        ws.onerror = (err) => {
          if (connectionIdRef.current !== myId) return;
          onErrorRef.current?.(err);
        };

        ws.onclose = () => {
          if (connectionIdRef.current !== myId) {
            finish();
            return;
          }
          clearConnectTimer();
          stopKeepAlive();
          wsRef.current = null;
          connectedKeywordsRef.current = [];
          setState('closed');
          onCloseRef.current?.();
          finish();
        };
      });
    },
    [clearConnectTimer, setState, stopKeepAlive],
  );

  const finalize = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || connectionStateRef.current !== 'open') return;
    try {
      ws.send(JSON.stringify({ type: 'Finalize' }));
    } catch {
      /* empty */
    }
  }, []);

  const sendAudio = useCallback((chunk: ArrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || connectionStateRef.current !== 'open' || ws.readyState !== 1) {
      return;
    }
    try {
      ws.send(chunk);
    } catch {
      /* empty */
    }
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connectionState,
    connectionStateRef,
    connectedKeywordsRef,
    connect,
    disconnect,
    finalize,
    sendAudio,
  };
}
