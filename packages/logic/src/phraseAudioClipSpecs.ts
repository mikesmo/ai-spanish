import type { Language, Phrase } from './types';

/** One TTS / S3 clip derived from a transcript phrase (no voice — batch adds that). */
export interface PhraseAudioClipSpec {
  id: string;
  phraseIndex: number;
  language: Language;
  text: string;
}

function isNonEmpty(text: string): boolean {
  return text.trim() !== '';
}

/**
 * Flattens transcript phrases into clip specs with stable ids `{index}-{lang}-{field}`.
 * Same job set as legacy tts-batch `buildTtsJobs` (skips empty segments).
 */
export function buildPhraseAudioClipSpecs(phrases: Phrase[]): PhraseAudioClipSpec[] {
  const specs: PhraseAudioClipSpec[] = [];
  for (const phrase of phrases) {
    const i = phrase.index;
    const firstIntro = phrase.English['first-intro'] ?? '';
    if (isNonEmpty(firstIntro)) {
      specs.push({
        id: `${i}-en-first-intro`,
        phraseIndex: i,
        language: 'en',
        text: firstIntro,
      });
    }
    if (isNonEmpty(phrase.English['second-intro'])) {
      specs.push({
        id: `${i}-en-second-intro`,
        phraseIndex: i,
        language: 'en',
        text: phrase.English['second-intro'],
      });
    }
    if (isNonEmpty(phrase.Spanish.answer)) {
      specs.push({
        id: `${i}-es-answer`,
        phraseIndex: i,
        language: 'es',
        text: phrase.Spanish.answer,
      });
    }
  }
  return specs;
}
