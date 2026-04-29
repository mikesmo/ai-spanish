import { buildPhraseAudioClipSpecs } from '@ai-spanish/logic';
import type { Phrase } from '@ai-spanish/logic';

import type { TtsJob } from './types.js';
import { getVoiceForLanguage } from './tts-client.js';

/**
 * Flattens transcript phrases into TTS jobs with stable ids `{index}-{lang}-{field}`.
 */
export function buildTtsJobs(phrases: Phrase[]): TtsJob[] {
  return buildPhraseAudioClipSpecs(phrases).map((spec) => ({
    id: spec.id,
    language: spec.language,
    text: spec.text,
    voice: getVoiceForLanguage(spec.language),
  }));
}
