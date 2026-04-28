import type { Phrase } from '@ai-spanish/logic';
import type { TtsJob } from './types.js';
import { getVoiceForLanguage } from './tts-client.js';

function isNonEmpty(text: string): boolean {
  return text.trim() !== '';
}

/**
 * Flattens transcript phrases into TTS jobs with stable ids `{index}-{lang}-{field}`.
 */
export function buildTtsJobs(phrases: Phrase[]): TtsJob[] {
  const jobs: TtsJob[] = [];
  for (const phrase of phrases) {
    const i = phrase.index;
    const firstIntro = phrase.English['first-intro'] ?? '';
    if (isNonEmpty(firstIntro)) {
      jobs.push({
        id: `${i}-en-first-intro`,
        language: 'en',
        text: firstIntro,
        voice: getVoiceForLanguage('en'),
      });
    }
    if (isNonEmpty(phrase.English['second-intro'])) {
      jobs.push({
        id: `${i}-en-second-intro`,
        language: 'en',
        text: phrase.English['second-intro'],
        voice: getVoiceForLanguage('en'),
      });
    }
    if (isNonEmpty(phrase.Spanish.answer)) {
      jobs.push({
        id: `${i}-es-answer`,
        language: 'es',
        text: phrase.Spanish.answer,
        voice: getVoiceForLanguage('es'),
      });
    }
  }
  return jobs;
}
