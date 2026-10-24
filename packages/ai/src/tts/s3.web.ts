import { useCallback, useRef } from 'react';
import type {
  Language,
  LessonAudioClip,
  TTSAdapter,
  TtsAdapterOptions,
} from '@ai-spanish/logic';
import {
  createS3ClipUrlResolver,
  fetchBatchPresignedUrls,
  fetchPresignedUrl,
  s3ClipCacheKey,
  segmentsForLanguage,
  type S3ClipUrlResolver,
} from './s3-shared';

function createWebClipUrlResolver(): S3ClipUrlResolver {
  return createS3ClipUrlResolver({
    fetchSingle: (phraseName, segment, s3LessonSegment, signal) =>
      fetchPresignedUrl('', phraseName, segment, signal, s3LessonSegment),
    fetchBatch: (clips, s3LessonSegment) =>
      fetchBatchPresignedUrls('', clips, s3LessonSegment),
  });
}

/**
 * S3-backed TTS adapter for web.
 *
 * - English: first-intro or second-intro per englishUseFirstIntro; appends
 *   question when englishAppendQuestion (intro ends with ":" after trim).
 * - Spanish: `answer` by default, or `answer-medium` / `answer-slow` per
 *   `options.spanishSegmentOverride`.
 * - Missing clips (skipped at batch time due to empty text) are silently skipped.
 * - Requires a valid phraseName; calls without one are no-ops so the adapter
 *   stays compatible with the TTSAdapter interface.
 * - `preloadLesson` presigns every clip in one request. Audio bytes are not
 *   preloaded: the S3 bucket sends no CORS headers, so `fetch` cannot read them.
 */
export function useS3TTS(): TTSAdapter {
  const resolverRef = useRef<S3ClipUrlResolver | null>(null);
  if (resolverRef.current === null) {
    resolverRef.current = createWebClipUrlResolver();
  }
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stoppedRef = useRef(false);
  /** Bumped on `stop()` and on each new `play()`; invalidates in-flight playback promises. */
  const playEpochRef = useRef(0);

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
      const resolver = resolverRef.current!;
      await Promise.all(
        segmentsForLanguage(lang, options).map(async (seg) => {
          if (signal?.aborted) return;
          await resolver.resolve(phraseName, seg, s3, signal);
        })
      );
    },
    []
  );

  const preloadLesson = useCallback(
    async (
      clips: readonly LessonAudioClip[],
      options?: { s3LessonSegment?: string; signal?: AbortSignal },
    ): Promise<void> => {
      await resolverRef.current!.presignLesson(clips, options?.s3LessonSegment);
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

      for (const seg of segmentsForLanguage(lang, options)) {
        if (playEpochRef.current !== myEpoch || stoppedRef.current || signal?.aborted) {
          return;
        }

        const cacheKey = s3ClipCacheKey(phraseName, seg, s3);
        /* eslint-disable no-await-in-loop -- segments play sequentially; stop() advances epoch */
        const clip = await resolverRef.current!.resolve(phraseName, seg, s3, signal);
        const url = clip?.url ?? null;
        if (playEpochRef.current !== myEpoch || !url || stoppedRef.current || signal?.aborted) {
          if (playEpochRef.current === myEpoch && signal?.aborted) return;
          continue;
        }

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
          el.src = url;
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

  return { play, prefetch, preloadLesson, stop };
}
