import type { LearnerQuestionRequestBody } from '@ai-spanish/logic';

/**
 * Posts a learner question to the Next.js streaming route and returns the raw
 * ReadableStream for the hook to consume. The AbortSignal is forwarded so the
 * underlying fetch is cancelled when the hook aborts (phrase change / unmount).
 */
export async function postLearnerQuestion(
  body: LearnerQuestionRequestBody,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch('/api/learner-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      text || `Request failed with status ${response.status}`,
    );
  }

  if (!response.body) {
    throw new Error('No response body received from server');
  }

  return response.body;
}
