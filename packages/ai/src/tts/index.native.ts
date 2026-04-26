import { useCallback } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import type { TTSAdapter, Language, TtsAdapterOptions } from '@ai-spanish/logic';

function getWebOrigin(): string {
  return (process.env.EXPO_PUBLIC_WEB_ORIGIN ?? '').replace(/\/$/, '');
}

async function fetchTtsAudioFromWeb(
  text: string,
  language: Language,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const origin = getWebOrigin();
  if (!origin) {
    throw new Error(
      'EXPO_PUBLIC_WEB_ORIGIN is not set. Required for text-to-speech.',
    );
  }
  const response = await fetch(`${origin}/api/text-to-speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, provider: 'deepgram', language }),
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `TTS request failed: ${response.status} ${response.statusText}`,
    );
  }
  return response.arrayBuffer();
}

const audioCache = new Map<string, string>(); // cacheKey → file URI
let currentSound: Audio.Sound | null = null;
let stopIntentionally = false;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function stopAudio(): Promise<void> {
  if (currentSound) {
    stopIntentionally = true;
    const sound = currentSound;
    currentSound = null;
    await sound.stopAsync().catch(() => {});
    await sound.unloadAsync().catch(() => {});
  }
}

async function fetchAndCacheAudio(
  text: string,
  language: Language,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const key = `${language}-${text}`;
  const cached = audioCache.get(key);
  if (cached) {
    const info = await FileSystem.getInfoAsync(cached);
    if (info.exists) return cached;
    audioCache.delete(key);
  }

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const buffer = await fetchTtsAudioFromWeb(text, language, signal);
  const base64 = arrayBufferToBase64(buffer);
  const fileUri = `${FileSystem.cacheDirectory}tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`;

  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  audioCache.set(key, fileUri);
  if (audioCache.size > 20) {
    const oldest = audioCache.keys().next().value!;
    const oldUri = audioCache.get(oldest)!;
    audioCache.delete(oldest);
    FileSystem.deleteAsync(oldUri, { idempotent: true }).catch(() => {});
  }
  return fileUri;
}

async function playAudio(
  text: string,
  language: Language,
  rate = 1,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return;
  await stopAudio();
  stopIntentionally = false;
  if (signal?.aborted) return;

  const fileUri = await fetchAndCacheAudio(text, language, signal);
  if (signal?.aborted) return;
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
  currentSound = sound;

  if (rate !== 1) await sound.setRateAsync(rate, true);

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal?.removeEventListener('abort', onAbort);
      stopIntentionally = true;
      void sound.stopAsync()
        .then(() => sound.unloadAsync().catch(() => {}))
        .finally(() => {
          if (currentSound === sound) currentSound = null;
          resolve();
        });
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    sound.setOnPlaybackStatusUpdate((status: { isLoaded: boolean; didJustFinish?: boolean }) => {
      if (!status.isLoaded) return;
      if (status.didJustFinish) {
        signal?.removeEventListener('abort', onAbort);
        sound.unloadAsync().catch(() => {});
        if (currentSound === sound) currentSound = null;
        resolve();
      }
    });
    sound.playAsync().catch((err: unknown) => {
      signal?.removeEventListener('abort', onAbort);
      if (stopIntentionally) resolve();
      else reject(err);
    });
  });
}

export function useTTS(): TTSAdapter {
  const play = useCallback(
    (text: string, lang: Language, rate?: number, _phraseIndex?: number, options?: TtsAdapterOptions) =>
      playAudio(text, lang, rate, options?.signal),
    []
  );
  const prefetch = useCallback(async (text: string, lang: Language, _phraseIndex?: number, options?: TtsAdapterOptions) => {
    try {
      await fetchAndCacheAudio(text, lang, options?.signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[TTS prefetch]', err);
    }
  }, []);
  const stop = useCallback(() => { stopAudio(); }, []);
  return { play, prefetch, stop };
}
