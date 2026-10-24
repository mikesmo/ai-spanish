/**
 * Deepgram live listen URL for the native RN WebSocket. Mirrors
 * `DEEPGRAM_LIVE_OPTIONS` in `index.native.ts` / the web adapter.
 */
export function buildDeepgramListenUrl(options: {
  language: string;
  keywords?: string[];
}): string {
  const params = new URLSearchParams();
  params.set('model', 'nova-2');
  params.set('language', options.language);
  params.set('interim_results', 'true');
  params.set('smart_format', 'true');
  params.set('endpointing', '1500');
  params.set('encoding', 'linear16');
  params.set('sample_rate', '16000');
  for (const keyword of options.keywords ?? []) {
    params.append('keywords', keyword);
  }
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}
