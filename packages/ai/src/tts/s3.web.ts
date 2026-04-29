import { useCallback, useRef } from 'react';
import type { Language, TTSAdapter, TtsAdapterOptions } from '@ai-spanish/logic';
import {
  PRESIGNED_URL_CACHE_TTL_MS,
  fetchPresignedUrl as _fetchPresignedUrl,
  segmentsForLanguage,
} from './s3-shared';

type CachedUrl = { url: string; fetchedAt: number };

function fetchPresignedUrl(
  phraseName: string,
  segment: string,
  signal: AbortSignal | undefined,
  s3LessonSegment: string | undefined
): Promise<string | null> {
  return _fetchPresignedUrl(
    '',
    phraseName,
    segment,
    signal,
    s3LessonSegment
  );
}

/**
 * S3-backed TTS adapter for web.
 *
 * - English: first-intro or second-intro per englishUseFirstIntro; appends
 *   question when englishAppendQuestion (intro ends with ":" after trim).
 * - Spanish: fetches and plays answer (single clip per phrase).
 * - Missing clips (skipped at batch time due to empty text) are silently skipped.
 * - Requires a valid phraseName; calls without one are no-ops so the adapter
 *   stays compatible with the TTSAdapter interface.
 */
export function useS3TTS(): TTSAdapter {
  /** Cache: `${phraseName}-${segment}` → presigned URL + time (S3 presigns expire in ~5 min). */
  const urlCache = useRef<Map<string, CachedUrl>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stoppedRef = useRef(false);
  /** Bumped on `stop()` and on each new `play()`; invalidates in-flight playback promises. */
  const playEpochRef = useRef(0);

  const getUrlFromCache = (key: string): string | null => {
    const e = urlCache.current.get(key);
    if (!e) return null;
    if (Date.now() - e.fetchedAt > PRESIGNED_URL_CACHE_TTL_MS) {
      urlCache.current.delete(key);
      return null;
    }
    return e.url;
  };

  const stop = useCallback(() => {
    playEpochRef.current += 1;
    stoppedRef.current = true;
    if (audioRef.current) {
      const el = audioRef.current;
      el.onended = null;
      el.onerror = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  }, []);

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
      const lessonKey = s3 ?? '';
      await Promise.all(
        segmentsForLanguage(lang, options).map(async (seg) => {
          if (signal?.aborted) return;
          const cacheKey = `${lessonKey}|${phraseName}-${seg}`;
          if (getUrlFromCache(cacheKey) != null) return;
          const url = await fetchPresignedUrl(phraseName, seg, signal, s3);
          if (signal?.aborted) return;
          if (url) urlCache.current.set(cacheKey, { url, fetchedAt: Date.now() });
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
      phraseName?: string,
      options?: TtsAdapterOptions
    ): Promise<void> => {
      if (phraseName === undefined || phraseName === '') return;
      const signal = options?.signal;
      if (signal?.aborted) return;

      playEpochRef.current += 1;
      const myEpoch = playEpochRef.current;
      stoppedRef.current = false;
      if (!audioRef.current) audioRef.current = new Audio();
      const el = audioRef.current;

      const s3 = options?.s3LessonSegment;
      const lessonKey = s3 ?? '';

      for (const seg of segmentsForLanguage(lang, options)) {
        if (playEpochRef.current !== myEpoch || stoppedRef.current || signal?.aborted) {
          return;
        }

        const cacheKey = `${lessonKey}|${phraseName}-${seg}`;
        let url: string | null = getUrlFromCache(cacheKey);
        if (!url) {
          const fetched = await fetchPresignedUrl(phraseName, seg, signal, s3);
          if (fetched) {
            url = fetched;
            // Only write to cache when this play is still the current one;
            // a superseded play's URL is valid but shouldn't count as cached.
            if (playEpochRef.current === myEpoch) {
              urlCache.current.set(cacheKey, { url, fetchedAt: Date.now() });
            }
          }
        }
        if (playEpochRef.current !== myEpoch || !url || stoppedRef.current || signal?.aborted) {
          if (playEpochRef.current === myEpoch && signal?.aborted) return;
          continue;
        }

        /* eslint-disable no-await-in-loop -- segments play sequentially; stop() advances epoch */
        await new Promise<void>((resolve, reject) => {
          if (playEpochRef.current !== myEpoch || signal?.aborted) {
            resolve();
            return;
          }

          const cleanup = () => {
            el.onended = null;
            el.onerror = null;
            signal?.removeEventListener('abort', onAbort);
          };

          const onAbort = () => {
            cleanup();
            resolve();
          };

          if (signal) {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
          }

          const onEnded = () => {
            cleanup();
            if (playEpochRef.current !== myEpoch) {
              resolve();
              return;
            }
            resolve();
          };

          const onError = () => {
            cleanup();
            if (playEpochRef.current !== myEpoch) {
              resolve();
              return;
            }
            if (stoppedRef.current) {
              resolve();
            } else {
              reject(new Error(`Audio playback error for ${cacheKey}`));
            }
          };

          el.onended = onEnded;
          el.onerror = onError;
          el.playbackRate = rate;
          el.src = url!;
          void el.play().catch((err: unknown) => {
            cleanup();
            if (playEpochRef.current !== myEpoch) {
              resolve();
            } else if (stoppedRef.current) {
              resolve();
            } else {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        });
        /* eslint-enable no-await-in-loop */
      }
    },
    []
  );

  return { play, prefetch, stop };
}
