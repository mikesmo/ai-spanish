import type { Language, Phrase } from './types';
import {
  languageForPhraseAudioSegment,
  phraseClipJobId,
  type PhraseSynthSegment,
} from './phraseAudioSegments';

/** Clip id suffix for Spanish answer at Deepgram speed 0.9 (paired with `{name}-answer`). */
export const PHRASE_ANSWER_MEDIUM_CLIP_SUFFIX = 'answer-medium';

/** Clip id suffix for Spanish answer at Deepgram speed 0.7 (paired with `{name}-answer`). */
export const PHRASE_ANSWER_SLOW_CLIP_SUFFIX = 'answer-slow';

/** One TTS / S3 clip derived from a transcript phrase (no voice — batch adds that). */
export interface PhraseAudioClipSpec {
  id: string;
  phraseIndex: number;
  phraseName: string;
  language: Language;
  text: string;
  /** Deepgram speaking rate (default 1). Used for multi-speed Spanish answer clips. */
  speakingRate?: number;
}

function isNonEmpty(text: string): boolean {
  return text.trim() !== '';
}

/**
 * Flattens transcript phrases into clip specs with stable ids `{name}-{field}`.
 * Fields: first-intro, second-intro, follow-up, explain (English), answer + answer-medium + answer-slow (Spanish).
 * Skips empty segments (same job set as tts-batch `buildTtsJobs`).
 */
export function buildPhraseAudioClipSpecs(phrases: Phrase[]): PhraseAudioClipSpec[] {
  const specs: PhraseAudioClipSpec[] = [];
  for (const phrase of phrases) {
    const name = phrase.name;
    const firstIntro = phrase.English['first-intro'] ?? '';
    if (isNonEmpty(firstIntro)) {
      const seg: PhraseSynthSegment = 'first-intro';
      specs.push({
        id: phraseClipJobId(name, seg),
        phraseIndex: phrase.index,
        phraseName: name,
        language: languageForPhraseAudioSegment(seg),
        text: firstIntro,
      });
    }
    if (isNonEmpty(phrase.English['second-intro'])) {
      const seg: PhraseSynthSegment = 'second-intro';
      specs.push({
        id: phraseClipJobId(name, seg),
        phraseIndex: phrase.index,
        phraseName: name,
        language: languageForPhraseAudioSegment(seg),
        text: phrase.English['second-intro'],
      });
    }
    const followUp = phrase.English['follow-up'] ?? '';
    if (isNonEmpty(followUp)) {
      const seg: PhraseSynthSegment = 'follow-up';
      specs.push({
        id: phraseClipJobId(name, seg),
        phraseIndex: phrase.index,
        phraseName: name,
        language: languageForPhraseAudioSegment(seg),
        text: followUp,
      });
    }
    const explain = phrase.English.explain ?? '';
    if (isNonEmpty(explain)) {
      const seg: PhraseSynthSegment = 'explain';
      specs.push({
        id: phraseClipJobId(name, seg),
        phraseIndex: phrase.index,
        phraseName: name,
        language: languageForPhraseAudioSegment(seg),
        text: explain,
      });
    }
    if (isNonEmpty(phrase.Spanish.answer)) {
      const seg: PhraseSynthSegment = 'answer';
      const answerText = phrase.Spanish.answer;
      specs.push({
        id: phraseClipJobId(name, seg),
        phraseIndex: phrase.index,
        phraseName: name,
        language: languageForPhraseAudioSegment(seg),
        text: answerText,
        speakingRate: 1,
      });
      specs.push({
        id: `${name}-${PHRASE_ANSWER_MEDIUM_CLIP_SUFFIX}`,
        phraseIndex: phrase.index,
        phraseName: name,
        language: 'es',
        text: answerText,
        speakingRate: 0.9,
      });
      specs.push({
        id: `${name}-${PHRASE_ANSWER_SLOW_CLIP_SUFFIX}`,
        phraseIndex: phrase.index,
        phraseName: name,
        language: 'es',
        text: answerText,
        speakingRate: 0.7,
      });
    }
  }
  return specs;
}
