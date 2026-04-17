const normalize = (s: string) =>
  s.toLowerCase().replace(/[¿?¡!.,;:'"…]/g, '').trim();

export const normalizeStr = (s: string) =>
  normalize(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

export type DiffEntry = {
  word: string;
  spanishWord: string | null;
  type: 'correct' | 'wrong' | 'missing';
};

export function diffWords(spoken: string, spanish: string): DiffEntry[] {
  const spokenWords = (spoken || '').trim().split(/\s+/).filter(Boolean);
  const spanishWords = (spanish || '').trim().split(/\s+/).filter(Boolean);
  const m = spokenWords.length;
  const n = spanishWords.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        normalize(spokenWords[i - 1]) === normalize(spanishWords[j - 1])
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: DiffEntry[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && normalize(spokenWords[i - 1]) === normalize(spanishWords[j - 1])) {
      result.unshift({ word: spokenWords[i - 1], spanishWord: spanishWords[j - 1], type: 'correct' });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ word: spanishWords[j - 1], spanishWord: spanishWords[j - 1], type: 'missing' });
      j--;
    } else {
      result.unshift({ word: spokenWords[i - 1], spanishWord: null, type: 'wrong' });
      i--;
    }
  }
  return result;
}
