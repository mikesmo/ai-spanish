import { useCallback, useRef } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import type { Language, TTSAdapter, TtsAdapterOptions } from '@ai-spanish/logic';
import { fetchPresignedUrl as _fetchPresignedUrl, segmentsForLanguage } from './s3-shared';

function getWebOrigin(): string {
  return (process.env.EXPO_PUBLIC_WEB_ORIGIN ?? '').replace(/\/$/, '');
}

function fetchPresignedUrl(phraseIndex: number, segment: string): Promise<string | null> {
  const origin = getWebOrigin();
  if (!origin) return Promise.resolve(null);
  return _fetchPresignedUrl(origin, phraseIndex, segment);
}

function localCachePath(phraseIndex: number, segment: string): string {
  return `${FileSystem.cacheDirectory}s3audio-${phraseIndex}-${segment}.mp3`;
}

async function ensureLocalFile(
  phraseIndex: number,
  segment: string,
  fileCache: Map<string, string>
): Promise<string | null> {
  const cacheKey = `${phraseIndex}-${segment}`;
  const cachedUri = fileCache.get(cacheKey);
  if (cachedUri) {
    const info = await FileSystem.getInfoAsync(cachedUri);
    if (info.exists) return cachedUri;
    fileCache.delete(cacheKey);
  }

  const presigned = await fetchPresignedUrl(phraseIndex, segment);
  if (!presigned) return null;

  const dest = localCachePath(phraseIndex, segment);
  const result = await FileSystem.downloadAsync(presigned, dest);
  fileCache.set(cacheKey, result.uri);
  return result.uri;
}

/**
 * S3-backed TTS adapter for React Native (same clips as web).
 *
 * - English: en-explain only when options.englishUseExplain, else en-intro +
 *   en-question.
 * - Spanish: es-question only.
 * - Missing clips are skipped silently.
 * - Requires phraseIndex; calls without it are no-ops.
 */
export function useS3TTS(): TTSAdapter {
  const fileCacheRef = useRef<Map<string, string>>(new Map());
  const currentSoundRef = useRef<Audio.Sound | null>(null);
  const stoppedRef = useRef(false);
  const stopIntentionallyRef = useRef(false);

  const unloadCurrentSound = useCallback(async () => {
    const sound = currentSoundRef.current;
    currentSoundRef.current = null;
    if (!sound) return;
    stopIntentionallyRef.current = true;
    await sound.stopAsync().catch(() => {});
    await sound.unloadAsync().catch(() => {});
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    void unloadCurrentSound();
  }, [unloadCurrentSound]);

  const playSegment = useCallback(async (fileUri: string, rate: number): Promise<void> => {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
    currentSoundRef.current = sound;
    stopIntentionallyRef.current = false;

    if (rate !== 1) await sound.setRateAsync(rate, true);

    try {
      await new Promise<void>((resolve, reject) => {
        sound.setOnPlaybackStatusUpdate((status: { isLoaded: boolean; didJustFinish?: boolean }) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            if (currentSoundRef.current === sound) currentSoundRef.current = null;
            resolve();
          }
        });
        sound.playAsync().catch((err: unknown) => {
          if (stopIntentionallyRef.current || stoppedRef.current) resolve();
          else reject(err);
        });
      });
    } finally {
      if (currentSoundRef.current === sound) currentSoundRef.current = null;
      await sound.unloadAsync().catch(() => {});
    }
  }, []);

  const prefetch = useCallback(
    async (
      _text: string,
      lang: Language,
      phraseIndex?: number,
      options?: TtsAdapterOptions
    ): Promise<void> => {
      if (phraseIndex === undefined) return;
      await Promise.all(
        segmentsForLanguage(lang, options).map(async (seg) => {
          await ensureLocalFile(phraseIndex, seg, fileCacheRef.current).catch(() => {});
        })
      );
    },
    []
  );

  const play = useCallback(
    async (
      _text: string,
      lang: Language,
      rate = 1,
      phraseIndex?: number,
      options?: TtsAdapterOptions
    ): Promise<void> => {
      if (phraseIndex === undefined) return;

      stoppedRef.current = false;
      await unloadCurrentSound();
      stopIntentionallyRef.current = false;

      for (const seg of segmentsForLanguage(lang, options)) {
        if (stoppedRef.current) return;

        const uri = await ensureLocalFile(phraseIndex, seg, fileCacheRef.current);
        if (!uri || stoppedRef.current) continue;

        try {
          await playSegment(uri, rate);
        } catch {
          // Skip failed segments (network/playback); matches silent skip for missing clips.
        }
      }
    },
    [playSegment, unloadCurrentSound]
  );

  return { play, prefetch, stop };
}
