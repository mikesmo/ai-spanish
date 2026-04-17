import type { Language } from '@ai-spanish/logic';

const DEEPGRAM_MODELS: Record<Language, string> = {
  en: 'aura-2-pandora-en',
  es: 'aura-2-agustina-es',
};

export async function fetchTTSAudio(
  text: string,
  language: Language,
  apiKey: string
): Promise<ArrayBuffer> {
  const model = DEEPGRAM_MODELS[language];
  const response = await fetch(`https://api.deepgram.com/v1/speak?model=${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`Deepgram TTS failed: ${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}
