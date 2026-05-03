import type { Language } from '@ai-spanish/logic';

const DEEPGRAM_MODELS: Record<Language, string> = {
  en: 'aura-2-amalthea-en',
  es: 'aura-2-diana-es',
};

export async function fetchTTSAudio(
  text: string,
  language: Language,
  apiKey: string,
  model?: string,
  signal?: AbortSignal,
  speed?: number,
): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const modelId = model?.trim() || DEEPGRAM_MODELS[language];
  const params = new URLSearchParams();
  params.set('model', modelId);
  if (speed !== undefined && Number.isFinite(speed) && speed !== 1) {
    params.set('speed', String(speed));
  }
  const response = await fetch(`https://api.deepgram.com/v1/speak?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok) throw new Error(`Deepgram TTS failed: ${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}
