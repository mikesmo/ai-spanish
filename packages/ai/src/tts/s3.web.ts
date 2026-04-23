import { useCallback, useRef } from 'react';
import type { Language, TTSAdapter } from '@ai-spanish/logic';
import { fetchPresignedUrl as _fetchPresignedUrl, segmentsForLanguage } from './s3-shared';

function fetchPresignedUrl(phraseIndex: number, segment: string): Promise<string | null> {
  return _fetchPresignedUrl('', phraseIndex, segment);
}

/**
 * S3-backed TTS adapter for web.
 *
 * - English: fetches and plays en-intro then en-question back-to-back so the
 *   two synthesized segments feel like one continuous utterance.
 * - Spanish: fetches and plays es-question (single clip per phrase).
 * - Missing clips (skipped at batch time due to empty text) are silently skipped.
 * - Requires a valid phraseIndex; calls without one are no-ops so the adapter
 *   stays compatible with the TTSAdapter interface.
 */
export function useS3TTS(): TTSAdapter {
  /** Cache: `${phraseIndex}-${segment}` → presigned URL */
  const urlCache = useRef<Map<string, string>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stoppedRef = useRef(false);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
  }, []);

  const prefetch = useCallback(
    async (_text: string, lang: Language, phraseIndex?: number): Promise<void> => {
      if (phraseIndex === undefined) return;
      await Promise.all(
        segmentsForLanguage(lang).map(async (seg) => {
          const cacheKey = `${phraseIndex}-${seg}`;
          if (urlCache.current.has(cacheKey)) return;
          const url = await fetchPresignedUrl(phraseIndex, seg);
          if (url) urlCache.current.set(cacheKey, url);
        })
      );
    },
    []
  );

  const play = useCallback(
    async (_text: string, lang: Language, rate = 1, phraseIndex?: number): Promise<void> => {
      if (phraseIndex === undefined) return;

      stoppedRef.current = false;
      if (!audioRef.current) audioRef.current = new Audio();
      const el = audioRef.current;

      // #region agent log
      const playStart = Date.now();
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '961193',
        },
        body: JSON.stringify({
          sessionId: '961193',
          runId: 'jacket-bleed',
          hypothesisId: 'H4-H5',
          location: 'tts/s3.web.ts:play:start',
          message: 'tts play start',
          data: { lang, phraseIndex, rate },
          timestamp: playStart,
        }),
      }).catch(() => {});
      // #endregion

      for (const seg of segmentsForLanguage(lang)) {
        if (stoppedRef.current) return;

        const cacheKey = `${phraseIndex}-${seg}`;
        let url = urlCache.current.get(cacheKey);
        if (!url) {
          url = (await fetchPresignedUrl(phraseIndex, seg)) ?? undefined;
          if (url) urlCache.current.set(cacheKey, url);
        }
        // #region agent log
        fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': '961193',
          },
          body: JSON.stringify({
            sessionId: '961193',
            runId: 'jacket-bleed',
            hypothesisId: 'H4-H5',
            location: 'tts/s3.web.ts:play:segment',
            message: 'tts segment attempt',
            data: {
              lang,
              phraseIndex,
              seg,
              hasUrl: !!url,
              stopped: stoppedRef.current,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        if (!url || stoppedRef.current) continue;

        await new Promise<void>((resolve, reject) => {
          el.src = url!;
          el.playbackRate = rate;
          el.onended = () => {
            // #region agent log
            fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Debug-Session-Id': '961193',
              },
              body: JSON.stringify({
                sessionId: '961193',
                runId: 'jacket-bleed',
                hypothesisId: 'H4-H5',
                location: 'tts/s3.web.ts:play:onended',
                message: 'tts segment ended',
                data: { lang, phraseIndex, seg, via: 'onended' },
                timestamp: Date.now(),
              }),
            }).catch(() => {});
            // #endregion
            resolve();
          };
          el.onerror = () => {
            // #region agent log
            fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Debug-Session-Id': '961193',
              },
              body: JSON.stringify({
                sessionId: '961193',
                runId: 'jacket-bleed',
                hypothesisId: 'H5',
                location: 'tts/s3.web.ts:play:onerror',
                message: 'tts segment error',
                data: {
                  lang,
                  phraseIndex,
                  seg,
                  stopped: stoppedRef.current,
                  src: (el.src || '').slice(0, 80),
                },
                timestamp: Date.now(),
              }),
            }).catch(() => {});
            // #endregion
            if (stoppedRef.current) resolve();
            else reject(new Error(`Audio playback error for ${cacheKey}`));
          };
          el.play().catch((err: unknown) => {
            if (stoppedRef.current) resolve();
            else reject(err);
          });
        });
      }
      // #region agent log
      fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '961193',
        },
        body: JSON.stringify({
          sessionId: '961193',
          runId: 'jacket-bleed',
          hypothesisId: 'H4-H5',
          location: 'tts/s3.web.ts:play:end',
          message: 'tts play resolved',
          data: { lang, phraseIndex, elapsedMs: Date.now() - playStart },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
    },
    []
  );

  return { play, prefetch, stop };
}
