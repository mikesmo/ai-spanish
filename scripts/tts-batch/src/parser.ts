import type { Phrase } from '@ai-spanish/logic';
import type { TtsJob } from './types.js';
import { VOICE_BY_LANGUAGE } from './tts-client.js';

function isNonEmpty(text: string): boolean {
  return text.trim() !== '';
}

/**
 * Flattens transcript phrases into TTS jobs with stable ids `{index}-{lang}-{field}`.
 */
export function buildTtsJobs(phrases: Phrase[]): TtsJob[] {
  const jobs: TtsJob[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const phrase = phrases[i]!;
    const firstIntro = phrase.English['first-intro'] ?? '';
    if (isNonEmpty(firstIntro)) {
      jobs.push({
        id: `${i}-en-first-intro`,
        language: 'en',
        text: firstIntro,
        voice: VOICE_BY_LANGUAGE.en,
      });
    }
    if (isNonEmpty(phrase.English['second-intro'])) {
      jobs.push({
        id: `${i}-en-second-intro`,
        language: 'en',
        text: phrase.English['second-intro'],
        voice: VOICE_BY_LANGUAGE.en,
      });
    }
    if (isNonEmpty(phrase.English.question)) {
      jobs.push({
        id: `${i}-en-question`,
        language: 'en',
        text: phrase.English.question,
        voice: VOICE_BY_LANGUAGE.en,
      });
    }
    if (isNonEmpty(phrase.Spanish.answer)) {
      jobs.push({
        id: `${i}-es-question`,
        language: 'es',
        text: phrase.Spanish.answer,
        voice: VOICE_BY_LANGUAGE.es,
      });
    }
  }
  return jobs;
}
