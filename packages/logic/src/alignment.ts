import { normalizeStr } from './comparison';
import type { SpokenWord, WordMeta } from './types';

export interface MatchedPair {
  target: WordMeta;
  spoken: SpokenWord;
}

export interface AlignmentResult {
  matched: MatchedPair[];
  missing: WordMeta[];
  extra: SpokenWord[];
}

const normalizeWord = (s: string): string => normalizeStr(s);

/**
 * LCS-based alignment between the canonical target phrase (with POS weights)
 * and the user's spoken words (with timestamps). Returns structured objects so
 * downstream stages (accuracy, fluency) can access weight and timing data.
 *
 * Case- and accent-insensitive thanks to normalizeStr.
 */
export function alignWords(
  target: WordMeta[],
  spoken: SpokenWord[],
): AlignmentResult {
  const m = target.length;
  const n = spoken.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const t = normalizeWord(target[i - 1]!.word);
      const s = normalizeWord(spoken[j - 1]!.word);
      dp[i]![j] =
        t === s
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  const matched: MatchedPair[] = [];
  const missing: WordMeta[] = [];
  const extra: SpokenWord[] = [];

  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const t = i > 0 ? normalizeWord(target[i - 1]!.word) : null;
    const s = j > 0 ? normalizeWord(spoken[j - 1]!.word) : null;

    if (i > 0 && j > 0 && t === s) {
      matched.unshift({ target: target[i - 1]!, spoken: spoken[j - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      extra.unshift(spoken[j - 1]!);
      j--;
    } else {
      missing.unshift(target[i - 1]!);
      i--;
    }
  }

  return { matched, missing, extra };
}
