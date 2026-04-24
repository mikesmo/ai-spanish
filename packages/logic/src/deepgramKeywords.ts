/**
 * Tokenize text for Deepgram’s `keywords` query param (Nova-2, live and prerecorded).
 * Accented characters are preserved (`más`, `está`); punctuation is stripped; tokens are
 * lowercased and deduped; 1-character tokens are dropped. Stays at or under
 * {@link DEEPGRAM_KEYWORD_MAX} so we remain within Deepgram’s practical limits.
 */
export const DEEPGRAM_KEYWORD_MAX = 100;

/**
 * @returns Unique keyword tokens, capped at {@link DEEPGRAM_KEYWORD_MAX}.
 * Live STT and `--verify-stt` both map these to `word:2` boosts (see `packages/ai` STT web).
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
