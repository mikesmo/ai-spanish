import type { Phrase } from './types';

/**
 * Tokenize text for Deepgram’s `keywords` query param (Nova-2, live and prerecorded).
 * Accented characters are preserved (`más`, `está`); punctuation is stripped; tokens are
 * lowercased and deduped; 1-character tokens are dropped. Stays at or under
 * {@link DEEPGRAM_KEYWORD_MAX} so we remain within Deepgram’s practical limits.
 */
export const DEEPGRAM_KEYWORD_MAX = 100;

/**
 * Boost for Deepgram live `keywords` (Nova-2). Moderate enough to nudge
 * short words without the hallucination risk of very high values.
 * @see {@link toDeepgramLiveKeywordParams}
 */
export const DEEPGRAM_KEYWORD_LIVE_BOOST = 2 as const;

/**
 * Maps tokenized keywords to Deepgram’s live `keywords` param (`word:boost` per value).
 * Call with tokens from {@link tokenizeForDeepgramKeywords} (or the same pipeline).
 */
export function toDeepgramLiveKeywordParams(
  tokens: string[],
  boost: number = DEEPGRAM_KEYWORD_LIVE_BOOST,
): string[] {
  return tokens.map((w) => `${w}:${boost}`);
}

/**
 * @returns Unique keyword tokens, capped at {@link DEEPGRAM_KEYWORD_MAX}.
 * For live STT, map with {@link toDeepgramLiveKeywordParams} before sending to the adapter;
 * prerecorded `--verify-stt` may use a different boost.
 */
export function tokenizeForDeepgramKeywords(s: string): string[] {
  return Array.from(
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{Letter}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1),
    ),
  ).slice(0, DEEPGRAM_KEYWORD_MAX);
}

/**
 * True when lesson `Spanish.words` has 1 or 2 entries (legacy short-phrase keyword biasing).
 */
function shouldBiasDeepgramKeywordsFromWordCount(phrase: Phrase): boolean {
  const n = phrase.Spanish.words.length;
  return n === 1 || n === 2;
}

/**
 * Keyword tokens for Deepgram live listen (`keywords` → {@link toDeepgramLiveKeywordParams}).
 * If `Spanish.recognitionHints` is non-empty, tokenizes that string; otherwise uses
 * `Spanish.answer` only when {@link shouldBiasDeepgramKeywordsFromWordCount} is true
 * (backward-compatible short-phrase behavior).
 */
export function deepgramLiveKeywordTokensForPhrase(phrase: Phrase): string[] {
  const hints = (phrase.Spanish.recognitionHints ?? '').trim();
  if (hints.length > 0) {
    return tokenizeForDeepgramKeywords(hints);
  }
  if (shouldBiasDeepgramKeywordsFromWordCount(phrase)) {
    return tokenizeForDeepgramKeywords(phrase.Spanish.answer);
  }
  return [];
}
