import type { Language } from '@ai-spanish/logic';
import { fetchTTSAudio } from '@ai-spanish/ai/tts/deepgram';
import { getVoiceForLanguage } from '@ai-spanish/ai/tts/voices';

export { getVoiceForLanguage } from '@ai-spanish/ai/tts/voices';

/**
 * Calls Deepgram TTS and returns raw MP3 bytes.
 */
export async function synthesizeToBuffer(
  text: string,
  language: Language,
  apiKey: string
): Promise<ArrayBuffer> {
  return fetchTTSAudio(text, language, apiKey, getVoiceForLanguage(language));
}
