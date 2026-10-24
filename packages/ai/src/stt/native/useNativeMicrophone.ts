import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { Deepgram } from 'react-native-deepgram';

const DEFAULT_SAMPLE_RATE = 16_000;
const BASE_NATIVE_SAMPLE_RATE = 16_000;

export type NativeMicErrorCode =
  | 'start_failed'
  | 'concurrent_recording_not_supported'
  | 'permission_denied'
  | 'start_error';

export class NativeMicStartError extends Error {
  readonly code: NativeMicErrorCode;

  constructor(code: NativeMicErrorCode, message: string) {
    super(message);
    this.name = 'NativeMicStartError';
    this.code = code;
  }
}

let cachedMicPermission = false;

const computeDownsampleFactor = (
  target: number | undefined,
  base: number = BASE_NATIVE_SAMPLE_RATE,
): number => {
  if (!target || target >= base || base <= 0) {
    return 1;
  }
  const ratio = Math.round(base / target);
  return ratio > 0 ? ratio : 1;
};

const downsampleInt16 = (
  data: Int16Array,
  factor: number,
): Int16Array => {
  if (factor <= 1 || data.length < factor) {
    return data;
  }
  const downsampled = new Int16Array(Math.floor(data.length / factor));
  for (let i = 0; i < downsampled.length; i++) {
    downsampled[i] = data[i * factor] ?? 0;
  }
  return downsampled;
};

async function ensureMicPermission(): Promise<boolean> {
  if (cachedMicPermission) return true;
  if (Platform.OS === 'ios') {
    const MicPermission = NativeModules.MicPermission as
      | { request: () => Promise<boolean> }
      | undefined;
    if (!MicPermission) return false;
    const granted = await MicPermission.request();
    cachedMicPermission = granted;
    return granted;
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  const granted = result === PermissionsAndroid.RESULTS.GRANTED;
  cachedMicPermission = granted;
  return granted;
}

function classifyStartError(err: unknown): NativeMicStartError {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('concurrent_recording_not_supported')) {
    return new NativeMicStartError(
      'concurrent_recording_not_supported',
      message,
    );
  }
  if (message.includes('start_failed') || message.includes('RECORDING state')) {
    return new NativeMicStartError('start_failed', message);
  }
  return new NativeMicStartError('start_error', message);
}

export function useNativeMicrophone(onChunk: (pcm: ArrayBuffer) => void): {
  isLive: boolean;
  chunkCount: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  resetChunkCount: () => void;
} {
  const [isLive, setIsLive] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const sessionActiveRef = useRef(false);
  const audioSubRef = useRef<{ remove: () => void } | null>(null);
  const nativeInputSampleRateRef = useRef(BASE_NATIVE_SAMPLE_RATE);
  const downsampleFactorRef = useRef(1);
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  const detachEmitter = useCallback(() => {
    if (audioSubRef.current) {
      audioSubRef.current.remove();
      audioSubRef.current = null;
    }
  }, []);

  const attachEmitter = useCallback(() => {
    detachEmitter();
    const emitter = new NativeEventEmitter(NativeModules.Deepgram);
    const eventName = Platform.select({
      ios: 'DeepgramAudioPCM',
      android: 'AudioChunk',
    }) as string;
    audioSubRef.current = emitter.addListener(eventName, (raw) => {
      if (!sessionActiveRef.current) return;
      const ev = raw as {
        sampleRate?: number;
        b64?: string;
        data?: number[];
      };
      if (typeof ev?.sampleRate === 'number' && ev.sampleRate > 0) {
        if (ev.sampleRate !== nativeInputSampleRateRef.current) {
          nativeInputSampleRateRef.current = ev.sampleRate;
          downsampleFactorRef.current = computeDownsampleFactor(
            DEFAULT_SAMPLE_RATE,
            nativeInputSampleRateRef.current,
          );
        }
      }
      const factor = downsampleFactorRef.current;
      let chunk: ArrayBuffer | undefined;
      if (typeof ev?.b64 === 'string') {
        const binary = globalThis.atob(ev.b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        let int16 = new Int16Array(
          bytes.buffer,
          bytes.byteOffset,
          Math.floor(bytes.byteLength / 2),
        );
        int16 = downsampleInt16(int16, factor);
        chunk = int16.buffer.slice(
          int16.byteOffset,
          int16.byteOffset + int16.byteLength,
        );
      } else if (Array.isArray(ev?.data)) {
        const bytes = new Uint8Array(ev.data.length);
        for (let i = 0; i < ev.data.length; i++) {
          const v = ev.data[i] ?? 0;
          bytes[i] = v < 0 ? v + 256 : v;
        }
        const view = new DataView(bytes.buffer);
        const int16 = new Int16Array(Math.floor(bytes.length / 2));
        for (let i = 0; i < int16.length; i++) {
          int16[i] = view.getInt16(i * 2, true);
        }
        const downsampled = downsampleInt16(int16, factor);
        chunk = downsampled.buffer.slice(
          downsampled.byteOffset,
          downsampled.byteOffset + downsampled.byteLength,
        );
      }
      if (!chunk) return;
      setChunkCount((n) => n + 1);
      onChunkRef.current(chunk);
    });
  }, [detachEmitter]);

  const resetChunkCount = useCallback(() => {
    setChunkCount(0);
  }, []);

  const start = useCallback(async (): Promise<void> => {
    const granted = await ensureMicPermission();
    if (!granted) {
      throw new NativeMicStartError(
        'permission_denied',
        'Microphone permission denied',
      );
    }
    attachEmitter();
    try {
      await Deepgram.startRecording();
    } catch (err) {
      sessionActiveRef.current = false;
      detachEmitter();
      setIsLive(false);
      throw classifyStartError(err);
    }
    sessionActiveRef.current = true;
    setIsLive(true);
  }, [attachEmitter, detachEmitter]);

  const stop = useCallback(async (): Promise<void> => {
    sessionActiveRef.current = false;
    detachEmitter();
    try {
      await Deepgram.stopRecording();
    } catch {
      /* empty */
    }
    setIsLive(false);
  }, [detachEmitter]);

  useEffect(() => {
    return () => {
      sessionActiveRef.current = false;
      detachEmitter();
      void Deepgram.stopRecording().catch(() => {});
    };
  }, [detachEmitter]);

  return {
    isLive,
    chunkCount,
    start,
    stop,
    resetChunkCount,
  };
}
