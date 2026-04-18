import type { DiffWordResult } from "../PhraseDisplay.types";

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[¿?¡!.,;:'"…]/g, "").trim();

/**
 * Produces a diff between spoken and expected Spanish words.
 */
export const diffWords = (
  spoken: string,
  spanish: string,
): DiffWordResult[] => {
  const spokenWords = spoken.trim().split(/\s+/).filter(Boolean);
  const spanishWords = spanish.trim().split(/\s+/).filter(Boolean);
  const spokenWordCount = spokenWords.length;
  const spanishWordCount = spanishWords.length;

  const dp: number[][] = Array.from({ length: spokenWordCount + 1 }, () =>
    Array(spanishWordCount + 1).fill(0),
  );

  for (let spokenIndex = 1; spokenIndex <= spokenWordCount; spokenIndex += 1) {
    for (let spanishIndex = 1; spanishIndex <= spanishWordCount; spanishIndex += 1) {
      dp[spokenIndex][spanishIndex] =
        normalize(spokenWords[spokenIndex - 1]) ===
        normalize(spanishWords[spanishIndex - 1])
          ? dp[spokenIndex - 1][spanishIndex - 1] + 1
          : Math.max(dp[spokenIndex - 1][spanishIndex], dp[spokenIndex][spanishIndex - 1]);
    }
  }

  const result: DiffWordResult[] = [];
  let spokenIndex = spokenWordCount;
  let spanishIndex = spanishWordCount;

  while (spokenIndex > 0 || spanishIndex > 0) {
    if (
      spokenIndex > 0 &&
      spanishIndex > 0 &&
      normalize(spokenWords[spokenIndex - 1]) ===
        normalize(spanishWords[spanishIndex - 1])
    ) {
      result.unshift({
        word: spokenWords[spokenIndex - 1],
        spanishWord: spanishWords[spanishIndex - 1],
        type: "correct",
      });
      spokenIndex -= 1;
      spanishIndex -= 1;
    } else if (
      spanishIndex > 0 &&
      (spokenIndex === 0 ||
        dp[spokenIndex][spanishIndex - 1] >= dp[spokenIndex - 1][spanishIndex])
    ) {
      result.unshift({
        word: spanishWords[spanishIndex - 1],
        spanishWord: spanishWords[spanishIndex - 1],
        type: "missing",
      });
      spanishIndex -= 1;
    } else {
      result.unshift({
        word: spokenWords[spokenIndex - 1],
        spanishWord: null,
        type: "wrong",
      });
      spokenIndex -= 1;
    }
  }

  return result;
};
