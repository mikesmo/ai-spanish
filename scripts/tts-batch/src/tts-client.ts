import type { Language } from '@ai-spanish/logic';
import { fetchTTSAudio } from '@ai-spanish/ai/tts/deepgram';

/** Mirrors models in packages/ai/src/tts/deepgram.ts (used for manifest + cache hashing). */
export const VOICE_BY_LANGUAGE: Record<Language, string> = {
  en: 'aura-2-pandora-en',
  es: 'aura-2-agustina-es',
};

/**
 * Calls Deepgram TTS and returns raw MP3 bytes.
 */
export async function synthesizeToBuffer(
  text: string,
  language: Language,
  apiKey: string
): Promise<ArrayBuffer> {
  return fetchTTSAudio(text, language, apiKey);
}
