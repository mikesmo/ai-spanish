import { buildPhraseAudioClipSpecs } from '@ai-spanish/logic';
import type { Phrase } from '@ai-spanish/logic';

import type { TtsJob } from './types.js';
import { getVoiceForLanguage } from './tts-client.js';

/**
 * Flattens transcript phrases into TTS jobs with stable ids `{phraseName}-{field}`.
 * `index` on each job is the transcript phrase object's `"index"` (repeated for each clip).
 */
export function buildTtsJobs(phrases: Phrase[]): TtsJob[] {
  const phraseByName = new Map(phrases.map((p) => [p.name, p]));
  return buildPhraseAudioClipSpecs(phrases).map((spec) => {
    const phrase = phraseByName.get(spec.phraseName);
    if (!phrase) {
      throw new Error(
        `Internal error: transcript has no phrase named "${spec.phraseName}"`
      );
    }
    return {
      id: spec.id,
      index: phrase.index,
      phraseName: phrase.name,
      language: spec.language,
      text: spec.text,
      voice: getVoiceForLanguage(spec.language),
    };
  });
}
