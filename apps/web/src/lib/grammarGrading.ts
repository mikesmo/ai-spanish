import type { GrammarGradingRequest, GrammarGradingResult } from '@ai-spanish/logic';

/**
 * Posts a grammar grading request to the Next.js route and returns the
 * structured result. This is the web platform's implementation of
 * `PostGrammarGrading` from `@ai-spanish/logic`.
 */
export async function postGrammarGrading(
  request: GrammarGradingRequest,
): Promise<GrammarGradingResult> {
  const response = await fetch('/api/grammar-grading', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      text || `Grammar grading request failed with status ${response.status}`,
    );
  }

  const data = (await response.json()) as GrammarGradingResult;
  return data;
}
