import { createClient } from '@deepgram/sdk';
import type { SyncPrerecordedResponse } from '@deepgram/sdk';
import {
  tokenizeForDeepgramKeywords,
  transcriptsMatch,
  type Language,
} from '@ai-spanish/logic';

import { withRetry } from './async-retry.js';

const DEEPGRAM_LANG: Record<Language, string> = {
  en: 'en',
  es: 'es',
};

function getTranscriptFromResult(result: SyncPrerecordedResponse | null): string {
  if (!result?.results?.channels?.[0]) return '';
  const alt = result.results.channels[0].alternatives?.[0];
  return alt?.transcript?.trim() ?? '';
}

/**
 * Deepgram Nova-2 prerecorded transcript of MP3 bytes; compares to expected lesson text.
 */
export async function verifyMp3BufferMatchesTranscript(
  buf: Buffer,
  expectedText: string,
  language: Language,
  apiKey: string
): Promise<
  | { ok: true; transcript: string }
  | { ok: false; kind: 'mismatch'; transcript: string }
  | { ok: false; kind: 'api'; message: string }
> {
  const client = createClient(apiKey);
  const kws = tokenizeForDeepgramKeywords(expectedText);
  const useKeywords = kws.length >= 3;
  const opts = {
    model: 'nova-2' as const,
    language: DEEPGRAM_LANG[language],
    smart_format: true,
    ...(useKeywords ? { keywords: kws.map((w) => `${w}:1`) } : {}),
  };
  const { result, error } = await withRetry(
    () => client.listen.prerecorded.transcribeFile(buf, opts),
    { maxAttempts: 3 }
  );
  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: 'api', message: msg };
  }
  if (!result) {
    return { ok: false, kind: 'api', message: 'empty Deepgram result' };
  }
  const said = getTranscriptFromResult(result);
  if (transcriptsMatch(expectedText, said, language)) {
    return { ok: true, transcript: said };
  }
  return { ok: false, kind: 'mismatch', transcript: said };
}
