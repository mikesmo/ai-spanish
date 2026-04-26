import { useCallback, useRef } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import type { Language, TTSAdapter, TtsAdapterOptions } from '@ai-spanish/logic';
import {
  PRESIGNED_URL_CACHE_TTL_MS,
  fetchPresignedUrl as _fetchPresignedUrl,
  segmentsForLanguage,
} from './s3-shared';

type PresignedEntry = { url: string; fetchedAt: number };

function getWebOrigin(): string {
  return (process.env.EXPO_PUBLIC_WEB_ORIGIN ?? '').replace(/\/$/, '');
}

function fetchPresignedUrl(
  phraseIndex: number,
  segment: string,
  presignedByKey: Map<string, PresignedEntry>,
  cacheKey: string,
  signal: AbortSignal | undefined,
  s3LessonSegment: string | undefined
): Promise<string | null> {
  const origin = getWebOrigin();
  if (!origin) return Promise.resolve(null);
  const e = presignedByKey.get(cacheKey);
  if (e && Date.now() - e.fetchedAt <= PRESIGNED_URL_CACHE_TTL_MS) {
    return Promise.resolve(e.url);
  }
  return (async () => {
    if (signal?.aborted) return null;
    const url = await _fetchPresignedUrl(
      origin,
      phraseIndex,
      segment,
      signal,
      s3LessonSegment
    );
    if (url) presignedByKey.set(cacheKey, { url, fetchedAt: Date.now() });
    return url;
  })();
}

function localCachePath(
  phraseIndex: number,
  segment: string,
  s3LessonSegment?: string
): string {
  const p =
    s3LessonSegment != null && s3LessonSegment !== ''
      ? `${s3LessonSegment}-`
      : '';
  return `${FileSystem.cacheDirectory}s3audio-${p}${phraseIndex}-${segment}.mp3`;
}

async function ensureLocalFile(
  phraseIndex: number,
  segment: string,
  fileCache: Map<string, string>,
  presignedByKey: Map<string, PresignedEntry>,
  signal: AbortSignal | undefined,
  s3LessonSegment: string | undefined
): Promise<string | null> {
  if (signal?.aborted) return null;
  const lessonKey = s3LessonSegment ?? '';
  const cacheKey = `${lessonKey}|${phraseIndex}-${segment}`;
  const cachedUri = fileCache.get(cacheKey);
  if (cachedUri) {
    const info = await FileSystem.getInfoAsync(cachedUri);
    if (info.exists) return cachedUri;
    fileCache.delete(cacheKey);
  }

  const presigned = await fetchPresignedUrl(
    phraseIndex,
    segment,
    presignedByKey,
    cacheKey,
    signal,
    s3LessonSegment
  );
  if (!presigned) return null;
  if (signal?.aborted) return null;

  const dest = localCachePath(phraseIndex, segment, s3LessonSegment);
  const result = await FileSystem.downloadAsync(presigned, dest);
  if (signal?.aborted) return null;
  fileCache.set(cacheKey, result.uri);
  return result.uri;
}

/**
 * S3-backed TTS adapter for React Native (same clips as web).
 *
 * - English: en-first-intro or en-second-intro per englishUseFirstIntro; appends
 *   en-question when englishAppendQuestion (intro ends with ":" after trim).
 * - Spanish: es-answer only.
 * - Missing clips are skipped silently.
 * - Requires phraseIndex; calls without it are no-ops.
 */
export function useS3TTS(): TTSAdapter {
  const fileCacheRef = useRef<Map<string, string>>(new Map());
  const presignedByKeyRef = useRef<Map<string, PresignedEntry>>(new Map());
  const currentSoundRef = useRef<Audio.Sound | null>(null);
  const stoppedRef = useRef(false);
  const stopIntentionallyRef = useRef(false);
  /** Await before `createAsync` so interleaved `play()` cannot overlap unload. */
  const unloadInFlightRef = useRef<Promise<void> | null>(null);

  const runUnload = useCallback(async () => {
    const sound = currentSoundRef.current;
    currentSoundRef.current = null;
    if (!sound) return;
    stopIntentionallyRef.current = true;
    await sound.stopAsync().catch(() => {});
    await sound.unloadAsync().catch(() => {});
  }, []);

  const awaitUnload = useCallback(async () => {
    if (unloadInFlightRef.current) {
      try {
        await unloadInFlightRef.current;
      } catch {
        /* empty */
      }
    }
  }, []);

  const unloadWithTracking = useCallback(async () => {
    await awaitUnload();
    const p = runUnload();
    unloadInFlightRef.current = p;
    try {
      await p;
    } finally {
      if (unloadInFlightRef.current === p) {
        unloadInFlightRef.current = null;
      }
    }
  }, [awaitUnload, runUnload]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    void unloadWithTracking();
  }, [unloadWithTracking]);

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
      const signal = options?.signal;
      const s3 = options?.s3LessonSegment;
      await Promise.all(
        segmentsForLanguage(lang, options).map(async (seg) => {
          if (signal?.aborted) return;
          await ensureLocalFile(
            phraseIndex,
            seg,
            fileCacheRef.current,
            presignedByKeyRef.current,
            signal,
            s3
          ).catch(() => {});
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
      const signal = options?.signal;
      if (signal?.aborted) return;

      stoppedRef.current = false;
      await unloadWithTracking();
      if (signal?.aborted) return;
      stopIntentionallyRef.current = false;

      for (const seg of segmentsForLanguage(lang, options)) {
        if (stoppedRef.current || signal?.aborted) return;

        const uri = await ensureLocalFile(
          phraseIndex,
          seg,
          fileCacheRef.current,
          presignedByKeyRef.current,
          signal,
          options?.s3LessonSegment
        );
        if (!uri || stoppedRef.current || signal?.aborted) continue;

        try {
          /* eslint-disable no-await-in-loop */
          await playSegment(uri, rate);
          /* eslint-enable no-await-in-loop */
        } catch {
          // Skip failed segments (network/playback); matches silent skip for missing clips.
        }
      }
    },
    [awaitUnload, playSegment, unloadWithTracking]
  );

  return { play, prefetch, stop };
}
