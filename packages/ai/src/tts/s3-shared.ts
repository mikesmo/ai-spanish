import type { Language, TtsAdapterOptions } from '@ai-spanish/logic';

export interface AudioUrlResponse {
  url: string;
}

export function segmentsForLanguage(
  lang: Language,
  options?: TtsAdapterOptions
): string[] {
  if (lang === 'en') {
    const segs = options?.englishUseFirstIntro
      ? ['en-first-intro']
      : ['en-second-intro'];
    if (options?.englishAppendQuestion) {
      segs.push('en-question');
    }
    return segs;
  }
  return ['es-question'];
}

/**
 * Fetches a presigned S3 URL for a single audio segment.
 *
 * @param baseUrl - Origin to prepend, e.g. "http://192.168.1.5:3000" for native
 *                  or "" for web (same-origin relative fetch).
 *
 * Returns null when the segment does not exist (e.g. empty intro text skipped
 * at batch time), when the API is unconfigured (503), or on network error.
 */
export async function fetchPresignedUrl(
  baseUrl: string,
  phraseIndex: number,
  segment: string
): Promise<string | null> {
  const params = new URLSearchParams({ phrase: String(phraseIndex), segment });
  try {
    const response = await fetch(`${baseUrl}/api/audio?${params.toString()}`);
    if (!response.ok) return null;
    const data = (await response.json()) as AudioUrlResponse;
    return data.url ?? null;
  } catch {
    return null;
  }
}
