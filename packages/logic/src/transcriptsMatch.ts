import type { Language } from './types';

/** Normalize fancy apostrophes / backtick to ASCII `'` for compare. */
const QUOTE_LIKE = /['\u2018\u2019`]/g;

/** All Unicode “Punctuation” characters — removed from both strings before compare. */
const ALL_PUNCTUATION = /\p{P}/gu;

/**
 * Base normalization: NFC, trim, single spaces, smart quotes → ASCII quote, lower case.
 */
function baseNormalize(s: string, language: Language): string {
  const loc = language === 'es' ? 'es' : 'en';
  return s
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(QUOTE_LIKE, "'")
    .toLocaleLowerCase(loc);
}

/**
 * String used for equality: normalized, then all punctuation removed, then spaces collapsed.
 */
function normalizeForCompare(s: string, language: Language): string {
  return baseNormalize(s, language)
    .replace(ALL_PUNCTUATION, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when prerecorded Deepgram transcript equals expected lesson text (normalized). */
export function transcriptsMatch(
  expected: string,
  actual: string,
  language: Language
): boolean {
  return normalizeForCompare(expected, language) === normalizeForCompare(actual, language);
}
