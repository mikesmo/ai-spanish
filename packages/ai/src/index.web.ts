export { useTTS } from './tts/index.web';
export { useS3TTS } from './tts/s3.web';
export { useSTT } from './stt/index.web';

/**
 * Stub for TypeScript builds that resolve `@ai-spanish/ai` to the web bundle.
 * On web, `/api/audio` uses the browser session cookie — no Bearer registration needed.
 */
export function registerNativeS3PresignAuthHeaders(
  _resolver: () => Promise<Record<string, string> | undefined>,
): void {
  /* no-op */
}
