import type { Language } from '@ai-spanish/logic';
import { fetchTTSAudio } from '@ai-spanish/ai/tts/deepgram';

const DEFAULT_VOICE_EN = 'aura-2-pandora-en';
const DEFAULT_VOICE_ES = 'aura-2-agustina-es';

function voiceFromEnv(varName: string, fallback: string): string {
  const v = process.env[varName]?.trim();
  return v && v.length > 0 ? v : fallback;
}

/**
 * Deepgram Aura voice model id for the batch job language. Read from env at
 * call time so `dotenv.config()` in the CLI runs before the first lookup.
 * Defaults match `DEEPGRAM_MODELS` in `@ai-spanish/ai` (`aura-2-pandora-en` /
 * `aura-2-agustina-es`).
 */
export function getVoiceForLanguage(language: Language): string {
  return language === 'en'
    ? voiceFromEnv('TTS_DEEPGRAM_VOICE_EN', DEFAULT_VOICE_EN)
    : voiceFromEnv('TTS_DEEPGRAM_VOICE_ES', DEFAULT_VOICE_ES);
}

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
