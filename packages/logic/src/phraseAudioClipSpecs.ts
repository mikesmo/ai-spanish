import type { Language, Phrase } from './types';

/** One TTS / S3 clip derived from a transcript phrase (no voice — batch adds that). */
export interface PhraseAudioClipSpec {
  id: string;
  phraseIndex: number;
  phraseName: string;
  language: Language;
  text: string;
}

function isNonEmpty(text: string): boolean {
  return text.trim() !== '';
}

/**
 * Flattens transcript phrases into clip specs with stable ids `{name}-{field}`,
 * where `field` is one of `first-intro`, `second-intro`, `answer`.
 * Skips empty segments (same job set as legacy tts-batch `buildTtsJobs`).
 */
export function buildPhraseAudioClipSpecs(phrases: Phrase[]): PhraseAudioClipSpec[] {
  const specs: PhraseAudioClipSpec[] = [];
  for (const phrase of phrases) {
    const name = phrase.name;
    const firstIntro = phrase.English['first-intro'] ?? '';
    if (isNonEmpty(firstIntro)) {
      specs.push({
        id: `${name}-first-intro`,
        phraseIndex: phrase.index,
        phraseName: name,
        language: 'en',
        text: firstIntro,
      });
    }
    if (isNonEmpty(phrase.English['second-intro'])) {
      specs.push({
        id: `${name}-second-intro`,
        phraseIndex: phrase.index,
        phraseName: name,
        language: 'en',
        text: phrase.English['second-intro'],
      });
    }
    if (isNonEmpty(phrase.Spanish.answer)) {
      specs.push({
        id: `${name}-answer`,
        phraseIndex: phrase.index,
        phraseName: name,
        language: 'es',
        text: phrase.Spanish.answer,
      });
    }
  }
  return specs;
}
