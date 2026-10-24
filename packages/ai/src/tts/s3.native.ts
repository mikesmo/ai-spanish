import { useCallback, useRef } from 'react';
import { Audio } from 'expo-av';
import type { AVPlaybackStatus } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import {
  type Language,
  type LessonAudioClip,
  type TTSAdapter,
  type TtsAdapterOptions,
} from '@ai-spanish/logic';
import {
  createS3ClipUrlResolver,
  fetchBatchPresignedUrls,
  fetchPresignedUrl,
  s3ClipCacheKey,
  segmentsForLanguage,
  type S3ClipUrlResolver,
} from './s3-shared';

/** Parallel downloads while preloading a lesson in the background. */
const PRELOAD_CONCURRENCY = 4;

/**
 * Resolved per presign request (runs after {@link registerNativeS3PresignAuthHeaders}).
 * Mobile must register so `/api/audio` receives `Authorization: Bearer` like other web APIs.
 */
let resolveNativeS3PresignAuthHeaders:
  | (() => Promise<Record<string, string> | undefined>)
  | undefined;

export function registerNativeS3PresignAuthHeaders(
  resolver: NonNullable<typeof resolveNativeS3PresignAuthHeaders>,
): void {
  resolveNativeS3PresignAuthHeaders = resolver;
}

function getWebOrigin(): string {
  return (process.env.EXPO_PUBLIC_WEB_ORIGIN ?? '').replace(/\/$/, '');
}

async function getAuthHeaders(): Promise<Record<string, string> | undefined> {
  if (typeof resolveNativeS3PresignAuthHeaders !== 'function') return undefined;
  const headers = await resolveNativeS3PresignAuthHeaders();
  return headers && Object.keys(headers).length > 0 ? headers : undefined;
}

function createNativeClipUrlResolver(): S3ClipUrlResolver {
  return createS3ClipUrlResolver({
    fetchSingle: async (phraseName, segment, s3LessonSegment, signal) => {
      const origin = getWebOrigin();
      if (!origin || signal?.aborted) return null;
      return fetchPresignedUrl(
        origin,
        phraseName,
        segment,
        signal,
        s3LessonSegment,
        await getAuthHeaders(),
      );
    },
    fetchBatch: async (clips, s3LessonSegment) => {
      const origin = getWebOrigin();
      if (!origin) return null;
      return fetchBatchPresignedUrls(origin, clips, s3LessonSegment, await getAuthHeaders());
    },
  });
}

/**
 * Versioned paths embed the S3 ETag, so a file on disk always matches the
 * current clip and can be reused across sessions and app restarts.
 * Unversioned paths (single-clip presigns) are only trusted in memory.
 */
function localCachePath(
  phraseName: string,
  segment: string,
  s3LessonSegment: string | undefined,
  version: string | null,
): string {
  const p =
    s3LessonSegment != null && s3LessonSegment !== ''
      ? `${s3LessonSegment}-`
      : '';
  const v = version ? `-${version.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}` : '';
  return `${FileSystem.cacheDirectory}s3audio-${p}${phraseName}-${segment}${v}.mp3`;
}

interface LocalClipCache {
  /** Clip cache key → local file URI. */
  files: Map<string, string>;
  /** Clip cache key → download in progress. */
  inFlight: Map<string, Promise<string | null>>;
}

/**
 * Drop a cached clip from both the in-memory map and disk. Used when a file
 * turns out to be unplayable so the next presentation re-downloads instead of
 * replaying a poisoned cache entry.
 */
async function evictLocalFile(cacheKey: string, cache: LocalClipCache): Promise<void> {
  const uri = cache.files.get(cacheKey);
  cache.files.delete(cacheKey);
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

async function downloadClip(
  phraseName: string,
  segment: string,
  s3LessonSegment: string | undefined,
  resolver: S3ClipUrlResolver,
): Promise<string | null> {
  const clip = await resolver.resolve(phraseName, segment, s3LessonSegment);
  if (!clip) return null;

  const dest = localCachePath(phraseName, segment, s3LessonSegment, clip.version);
  if (clip.version) {
    const info = await FileSystem.getInfoAsync(dest);
    if (info.exists && info.size > 0) return dest;
  }

  const result = await FileSystem.downloadAsync(clip.url, dest);
  if (result.status !== 200) {
    // A presigned URL for a missing object yields an S3 XML error body.
    // downloadAsync saves that body regardless; caching it as .mp3 poisons the
    // cache and makes expo-av fail with "media may be damaged" on every later play.
    // Treat it as a missing clip (skipped silently, per adapter contract).
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
    return null;
  }
  return result.uri;
}

/**
 * Local file for one clip. Concurrent callers (card prefetch, lesson preload,
 * play) share a single download per clip; that download ignores caller
 * signals so one caller aborting cannot fail the others.
 */
async function ensureLocalFile(
  phraseName: string,
  segment: string,
  s3LessonSegment: string | undefined,
  resolver: S3ClipUrlResolver,
  cache: LocalClipCache,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  if (signal?.aborted) return null;
  const cacheKey = s3ClipCacheKey(phraseName, segment, s3LessonSegment);
  const cachedUri = cache.files.get(cacheKey);
  if (cachedUri) {
    const info = await FileSystem.getInfoAsync(cachedUri);
    if (info.exists) {
      return cachedUri;
    }
    cache.files.delete(cacheKey);
  }

  let pending = cache.inFlight.get(cacheKey);
  if (!pending) {
    pending = downloadClip(phraseName, segment, s3LessonSegment, resolver)
      .then((uri) => {
        if (uri) cache.files.set(cacheKey, uri);
        return uri;
      })
      .catch(() => null)
      .finally(() => {
        cache.inFlight.delete(cacheKey);
      });
    cache.inFlight.set(cacheKey, pending);
  }
  const uri = await pending;
  return signal?.aborted ? null : uri;
}

/**
 * S3-backed TTS adapter for React Native (same clips as web).
 *
 * - English: first-intro or second-intro per englishUseFirstIntro; appends
 *   question when englishAppendQuestion (intro ends with ":" after trim).
 * - Spanish: `answer` by default, or `answer-medium` / `answer-slow` per
 *   `options.spanishSegmentOverride`.
 * - Missing clips are skipped silently.
 * - Requires phraseName; calls without it are no-ops.
 * - `preloadLesson` presigns the whole lesson in one request and downloads
 *   clips to the versioned disk cache in the background.
 */
export function useS3TTS(): TTSAdapter {
  const resolverRef = useRef<S3ClipUrlResolver | null>(null);
  if (resolverRef.current === null) {
    resolverRef.current = createNativeClipUrlResolver();
  }
  const localCacheRef = useRef<LocalClipCache>({ files: new Map(), inFlight: new Map() });
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

  const playSegment = useCallback(
    async (fileUri: string, rate: number, signal?: AbortSignal): Promise<void> => {
      if (signal?.aborted) return;
      const { sound } = await Audio.Sound.createAsync({ uri: fileUri });
      if (signal?.aborted) {
        await sound.unloadAsync().catch(() => {});
        return;
      }
      currentSoundRef.current = sound;
      stopIntentionallyRef.current = false;

      if (rate !== 1) await sound.setRateAsync(rate, true);

      let settled = false;
      const finish = (resolve: () => void) => {
        if (settled) return;
        settled = true;
        resolve();
      };

      let onAbortHandler: (() => void) | undefined;

      try {
        await new Promise<void>((resolve, reject) => {
          const resolveOnce = () => finish(resolve);

          onAbortHandler = () => {
            stopIntentionallyRef.current = true;
            if (currentSoundRef.current === sound) currentSoundRef.current = null;
            void sound.stopAsync().catch(() => {});
            resolveOnce();
          };
          if (signal) {
            signal.addEventListener('abort', onAbortHandler);
          }

          sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
            if (!status.isLoaded) {
              // Sound was unloaded externally (runUnload / tts.stop).
              // Resolve so the play() loop can exit cleanly.
              resolveOnce();
              return;
            }
            if (signal?.aborted || stoppedRef.current) {
              if (currentSoundRef.current === sound) currentSoundRef.current = null;
              resolveOnce();
              return;
            }
            const dur = status.durationMillis ?? 0;
            const pos = status.positionMillis ?? 0;
            const earlyStopped =
              'isBuffering' in status &&
              !status.isBuffering &&
              !status.isPlaying &&
              !status.didJustFinish &&
              dur > 200 &&
              pos > 400 &&
              pos < dur - 80;
            if (earlyStopped) {
              // Unexpected mid-clip stop (e.g. audio focus loss / backgrounding).
              // Mark stopped so the outer loop skips remaining segments.
              stoppedRef.current = true;
              if (currentSoundRef.current === sound) currentSoundRef.current = null;
              resolveOnce();
              return;
            }
            if (status.didJustFinish) {
              if (currentSoundRef.current === sound) currentSoundRef.current = null;
              resolveOnce();
            }
          });
          sound.playAsync().catch((err: unknown) => {
            if (stopIntentionallyRef.current || stoppedRef.current || signal?.aborted) resolveOnce();
            else reject(err);
          });
          // If already stopped/aborted before or during playAsync, finish immediately.
          if (signal?.aborted || stoppedRef.current) resolveOnce();
        });
      } finally {
        if (signal != null && onAbortHandler != null) {
          signal.removeEventListener('abort', onAbortHandler);
        }
        if (currentSoundRef.current === sound) currentSoundRef.current = null;
        await sound.unloadAsync().catch(() => {});
      }
    },
    [],
  );

  const prefetch = useCallback(
    async (
      _text: string,
      lang: Language,
      phraseName?: string,
      options?: TtsAdapterOptions
    ): Promise<void> => {
      if (phraseName === undefined || phraseName === '') return;
      const signal = options?.signal;
      const s3 = options?.s3LessonSegment;
      const resolver = resolverRef.current!;
      await Promise.all(
        segmentsForLanguage(lang, options).map((seg) =>
          ensureLocalFile(phraseName, seg, s3, resolver, localCacheRef.current, signal),
        ),
      );
    },
    []
  );

  const preloadLesson = useCallback(
    async (
      clips: readonly LessonAudioClip[],
      options?: { s3LessonSegment?: string; signal?: AbortSignal },
    ): Promise<void> => {
      const s3 = options?.s3LessonSegment;
      const signal = options?.signal;
      const resolver = resolverRef.current!;
      const isBatchReady = await resolver.presignLesson(clips, s3);
      if (!isBatchReady || signal?.aborted) return;

      const queue = clips.values();
      const worker = async (): Promise<void> => {
        for (const clip of queue) {
          if (signal?.aborted) return;
          /* eslint-disable-next-line no-await-in-loop -- bounded worker pool */
          await ensureLocalFile(
            clip.phraseName,
            clip.segment,
            s3,
            resolver,
            localCacheRef.current,
            signal,
          );
        }
      };
      await Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, worker));
    },
    []
  );

  const play = useCallback(
    async (
      _text: string,
      lang: Language,
      rate = 1,
      phraseName?: string,
      options?: TtsAdapterOptions
    ): Promise<void> => {
      if (phraseName === undefined || phraseName === '') return;
      const signal = options?.signal;
      if (signal?.aborted) return;

      stoppedRef.current = false;
      await unloadWithTracking();
      if (signal?.aborted) return;
      stopIntentionallyRef.current = false;

      // Set audio mode once per play call so audio focus is acquired before
      // the first segment and maintained across the loop.
      // `staysActiveInBackground` prevents Android from revoking audio focus
      // when the app briefly goes to the background (e.g. notification,
      // screen lock during a long intro clip).
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
      if (signal?.aborted || stoppedRef.current) return;

      const s3 = options?.s3LessonSegment;
      for (const seg of segmentsForLanguage(lang, options)) {
        if (stoppedRef.current || signal?.aborted) return;

        /* eslint-disable no-await-in-loop */
        const uri = await ensureLocalFile(
          phraseName,
          seg,
          s3,
          resolverRef.current!,
          localCacheRef.current,
          signal,
        );
        if (!uri || stoppedRef.current || signal?.aborted) continue;

        try {
          await playSegment(uri, rate, signal);
        } catch {
          // Skip failed segments (network/playback); matches silent skip for
          // missing clips. Evict the cached file so a corrupt/poisoned download
          // (e.g. an S3 error body saved as .mp3) is not replayed next time.
          await evictLocalFile(
            s3ClipCacheKey(phraseName, seg, s3),
            localCacheRef.current,
          );
        }
        /* eslint-enable no-await-in-loop */
      }
    },
    [playSegment, unloadWithTracking]
  );

  return { play, prefetch, preloadLesson, stop };
}
