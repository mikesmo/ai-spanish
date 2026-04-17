import { useCallback } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { fetchTTSAudio } from './deepgram';
import type { TTSAdapter, Language } from '@ai-spanish/logic';

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

async function fetchAndCacheAudio(text: string, language: Language): Promise<string> {
  const key = `${language}-${text}`;
  const cached = audioCache.get(key);
  if (cached) {
    const info = await FileSystem.getInfoAsync(cached);
    if (info.exists) return cached;
    audioCache.delete(key);
  }

  const apiKey = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY!;
  const buffer = await fetchTTSAudio(text, language, apiKey);
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

async function playAudio(text: string, language: Language, rate = 1): Promise<void> {
  await stopAudio();
  stopIntentionally = false;

  const fileUri = await fetchAndCacheAudio(text, language);
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
  currentSound = sound;

  if (rate !== 1) await sound.setRateAsync(rate, true);

  await new Promise<void>((resolve, reject) => {
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) return;
      if (status.didJustFinish) {
        sound.unloadAsync().catch(() => {});
        if (currentSound === sound) currentSound = null;
        resolve();
      }
    });
    sound.playAsync().catch((err) => {
      if (stopIntentionally) resolve();
      else reject(err);
    });
  });
}

export function useTTS(): TTSAdapter {
  const play = useCallback(
    (text: string, lang: Language, rate?: number) => playAudio(text, lang, rate),
    []
  );
  const prefetch = useCallback(async (text: string, lang: Language) => {
    await fetchAndCacheAudio(text, lang).catch((err) => console.error('[TTS prefetch]', err));
  }, []);
  const stop = useCallback(() => { stopAudio(); }, []);
  return { play, prefetch, stop };
}
