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

async function fetchAudio(text: string, language: Language): Promise<Blob> {
  const key: AudioCacheKey = `${text}-${language}`;
  const cached = audioCache.get(key);
  if (cached) return cached;

  const response = await fetch('/api/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, provider: 'deepgram', language }),
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

async function playAudio(text: string, language: Language, rate = 1): Promise<void> {
  if (!audioPlayer) audioPlayer = new Audio();
  const blob = await fetchAudio(text, language);
  const url = URL.createObjectURL(blob);
  stoppedIntentionally = false;
  audioPlayer.src = url;
  audioPlayer.playbackRate = rate;
  await new Promise<void>((resolve, reject) => {
    audioPlayer!.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audioPlayer!.onerror = () => {
      URL.revokeObjectURL(url);
      stoppedIntentionally ? resolve() : reject(new Error('Audio playback error'));
    };
    audioPlayer!.play().catch(reject);
  });
}

export function useTTS(): TTSAdapter {
  const play = useCallback(
    (text: string, lang: Language, rate?: number, _phraseIndex?: number, _options?: TtsAdapterOptions) =>
      playAudio(text, lang, rate),
    []
  );
  const prefetch = useCallback(async (text: string, lang: Language, _phraseIndex?: number, _options?: TtsAdapterOptions) => {
    await fetchAudio(text, lang).catch((err) => console.error('[TTS prefetch]', err));
  }, []);
  const stop = useCallback(() => stopAudio(), []);
  return { play, prefetch, stop };
}
