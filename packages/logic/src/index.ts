export * from './types';
export * from './comparison';
export * from './phrases';
export * from './s3-keys';
export { usePhraseDisplay } from './usePhraseDisplay';

// #region agent log
// Hypothesis A/C: detect whether the logic barrel is evaluated server-side
if (typeof window === 'undefined') {
  fetch('http://127.0.0.1:7558/ingest/b881d677-7b47-4b11-9235-321a294880c7', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'b089b2' },
    body: JSON.stringify({ sessionId: 'b089b2', hypothesisId: 'A-C', location: 'logic/index.ts:module-scope', message: '@ai-spanish/logic barrel evaluated in SERVER context', data: {}, timestamp: Date.now() }),
  }).catch(() => {});
}
// #endregion
