import { useCallback, useRef } from 'react';
import type { Language, TTSAdapter } from '@ai-spanish/logic';

interface AudioUrlResponse {
  url: string;
}

/**
 * Fetches a presigned S3 URL for a single audio segment.
 * Returns null when the segment does not exist (e.g. empty intro text that
 * was skipped at batch time) or when the API is unconfigured (503).
 */
async function fetchPresignedUrl(phraseIndex: number, segment: string): Promise<string | null> {
  const params = new URLSearchParams({
    phrase: String(phraseIndex),
    segment,
  });
  try {
    const response = await fetch(`/api/audio?${params.toString()}`);
    // #region agent log
    // Hypothesis A/B/C: log what audio index+segment is being requested and whether it resolved
    fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b089b2'},body:JSON.stringify({sessionId:'b089b2',hypothesisId:'A-B-C',location:'s3.web.ts:fetchPresignedUrl',message:'S3 audio request',data:{phraseIndex,segment,status:response.status,ok:response.ok},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!response.ok) return null;
    const data = (await response.json()) as AudioUrlResponse;
    return data.url ?? null;
  } catch {
    return null;
  }
}

function segmentsForLanguage(lang: Language): string[] {
  return lang === 'en' ? ['en-intro', 'en-question'] : ['es-question'];
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

      for (const seg of segmentsForLanguage(lang)) {
        if (stoppedRef.current) return;

        const cacheKey = `${phraseIndex}-${seg}`;
        let url = urlCache.current.get(cacheKey);
        if (!url) {
          url = (await fetchPresignedUrl(phraseIndex, seg)) ?? undefined;
          if (url) urlCache.current.set(cacheKey, url);
        }
        if (!url || stoppedRef.current) continue;

        await new Promise<void>((resolve, reject) => {
          el.src = url!;
          el.playbackRate = rate;
          el.onended = () => resolve();
          el.onerror = () => {
            if (stoppedRef.current) resolve();
            else reject(new Error(`Audio playback error for ${cacheKey}`));
          };
          el.play().catch((err: unknown) => {
            if (stoppedRef.current) resolve();
            else reject(err);
          });
        });
      }
    },
    []
  );

  return { play, prefetch, stop };
}
