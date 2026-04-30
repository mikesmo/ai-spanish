import type { Language } from '@ai-spanish/logic';

const DEFAULT_VOICE_EN = 'aura-2-pandora-en';
const DEFAULT_VOICE_ES = 'aura-2-agustina-es';

function voiceFromEnv(varName: string, fallback: string): string {
  const v = process.env[varName]?.trim();
  return v && v.length > 0 ? v : fallback;
}

/**
 * Deepgram Aura voice model id for TTS. Read from env at call time.
 * Defaults match `DEEPGRAM_MODELS` in `./deepgram.ts`.
 */
export function getVoiceForLanguage(language: Language): string {
  return language === 'en'
    ? voiceFromEnv('TTS_DEEPGRAM_VOICE_EN', DEFAULT_VOICE_EN)
    : voiceFromEnv('TTS_DEEPGRAM_VOICE_ES', DEFAULT_VOICE_ES);
}
