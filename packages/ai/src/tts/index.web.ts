import { useCallback } from 'react';
import type { TTSAdapter, Language, TtsAdapterOptions } from '@ai-spanish/logic';

// Web TTS calls the Next.js API route so the Deepgram key stays server-side.
// The route at /api/text-to-speech accepts { text, provider, language }.

type AudioCacheKey = string;
const audioCache = new Map<AudioCacheKey, Blob>();
let audioPlayer: HTMLAudioElement | null = null;
let stoppedIntentionally = false;

function stopAudio() {
  if (audioPlayer) {
    stoppedIntentionally = true;
    audioPlayer.pause();
    audioPlayer.src = '';
  }
}

async function fetchAudio(
  text: string,
  language: Language,
  signal?: AbortSignal
): Promise<Blob> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const key: AudioCacheKey = `${text}-${language}`;
  const cached = audioCache.get(key);
  if (cached) return cached;

  const response = await fetch('/api/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, provider: 'deepgram', language }),
    signal,
  });
  if (!response.ok) throw new Error(`TTS request failed: ${response.statusText}`);
  const blob = await response.blob();
  audioCache.set(key, blob);
  if (audioCache.size > 20) {
    const oldest = audioCache.keys().next().value!;
    audioCache.delete(oldest);
  }
  return blob;
}

async function playAudio(
  text: string,
  language: Language,
  rate = 1,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return;
  if (!audioPlayer) audioPlayer = new Audio();
  const blob = await fetchAudio(text, language, signal);
  if (signal?.aborted) return;
  const url = URL.createObjectURL(blob);
  stoppedIntentionally = false;
  audioPlayer.src = url;
  audioPlayer.playbackRate = rate;
  if (signal?.aborted) {
    URL.revokeObjectURL(url);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      URL.revokeObjectURL(url);
      audioPlayer!.onended = null;
      audioPlayer!.onerror = null;
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    audioPlayer!.onended = () => {
      signal?.removeEventListener('abort', onAbort);
      URL.revokeObjectURL(url);
      resolve();
    };
    audioPlayer!.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      URL.revokeObjectURL(url);
      stoppedIntentionally ? resolve() : reject(new Error('Audio playback error'));
    };
    audioPlayer!.play().catch(reject);
  });
}

export function useTTS(): TTSAdapter {
  const play = useCallback(
    (text: string, lang: Language, rate?: number, _phraseName?: string, options?: TtsAdapterOptions) =>
      playAudio(text, lang, rate, options?.signal),
    []
  );
  const prefetch = useCallback(async (text: string, lang: Language, _phraseName?: string, options?: TtsAdapterOptions) => {
    try {
      await fetchAudio(text, lang, options?.signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[TTS prefetch]', err);
    }
  }, []);
  const stop = useCallback(() => stopAudio(), []);
  return { play, prefetch, stop };
}
