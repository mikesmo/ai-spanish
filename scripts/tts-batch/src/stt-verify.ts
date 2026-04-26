import fs from 'node:fs/promises';
import path from 'node:path';

import { createClient } from '@deepgram/sdk';
import type { SyncPrerecordedResponse } from '@deepgram/sdk';
import { tokenizeForDeepgramKeywords, type Language } from '@ai-spanish/logic';

import { createJobQueue, withRetry } from './queue.js';
import { readManifest } from './writer.js';
import type { ManifestEntry } from './types.js';

/** Normalize fancy apostrophes / backtick to ASCII `'` for compare. */
const QUOTE_LIKE = /['\u2018\u2019`]/g;

/** All Unicode “Punctuation” characters — removed from both strings before compare. */
const ALL_PUNCTUATION = /\p{P}/gu;

/** Deepgram prerecorded `language` query param. */
const DEEPGRAM_LANG: Record<Language, string> = {
  en: 'en',
  es: 'es',
};

/**
 * Base normalization: NFC, trim, single spaces, smart quotes → ASCII quote, lower case.
 */
function baseNormalize(s: string, language: Language): string {
  const loc = language === 'es' ? 'es' : 'en';
  return s
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(QUOTE_LIKE, "'")
    .toLocaleLowerCase(loc);
}

/**
 * String used for equality: normalized, then all punctuation removed, then spaces collapsed.
 */
function normalizeForCompare(s: string, language: Language): string {
  return baseNormalize(s, language)
    .replace(ALL_PUNCTUATION, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function transcriptsMatch(
  expected: string,
  actual: string,
  language: Language
): boolean {
  return normalizeForCompare(expected, language) === normalizeForCompare(actual, language);
}

function getTranscriptFromResult(result: SyncPrerecordedResponse | null): string {
  if (!result?.results?.channels?.[0]) return '';
  const alt = result.results.channels[0].alternatives?.[0];
  return alt?.transcript?.trim() ?? '';
}

/**
 * @returns 0 if all pass, 1 if any mismatch or I/O / API error.
 */
export async function runVerifyStt(outDir: string, apiKey: string): Promise<number> {
  const { entries } = await readManifest(outDir);
  const client = createClient(apiKey);
  const limit = createJobQueue();
  const tasks = entries.map((entry) =>
    limit(async (): Promise<'ok' | 'mismatch' | 'error'> => {
      if (entry.text.trim().length <= 1) {
        console.warn(
          `[verify-stt] SKIP order=${entry.order} id=${entry.id} file=${entry.localFile} — expected text is too short for reliable STT; not scored`
        );
        return 'ok';
      }
      const abs = path.join(outDir, entry.localFile);
      let buf: Buffer;
      try {
        buf = await fs.readFile(abs);
      } catch {
        console.error(
          `[verify-stt] ERROR order=${entry.order} id=${entry.id} file=${entry.localFile} — missing or unreadable: ${abs}`
        );
        return 'error';
      }
      const kws = tokenizeForDeepgramKeywords(entry.text);
      // Very few tokens + high boost can over-bias STT (duplicate words). Live STT uses :2 on a small Spanish target; prerecorded here uses :1 and only when we have enough distinct tokens.
      const useKeywords = kws.length >= 3;
      const opts = {
        model: 'nova-2',
        language: DEEPGRAM_LANG[entry.language],
        smart_format: true,
        ...(useKeywords ? { keywords: kws.map((w) => `${w}:1`) } : {}),
      };
      const { result, error } = await withRetry(
        () => client.listen.prerecorded.transcribeFile(buf, opts),
        { maxAttempts: 3 }
      );
      if (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(
          `[verify-stt] ERROR order=${entry.order} id=${entry.id} file=${entry.localFile} — Deepgram: ${msg}`
        );
        return 'error';
      }
      if (!result) {
        console.error(
          `[verify-stt] ERROR order=${entry.order} id=${entry.id} file=${entry.localFile} — empty Deepgram result`
        );
        return 'error';
      }
      const said = getTranscriptFromResult(result);
      if (transcriptsMatch(entry.text, said, entry.language)) {
        return 'ok';
      }
      logMismatch(entry, said);
      return 'mismatch';
    })
  );
  const results = await Promise.all(tasks);
  let ok = 0;
  let mismatch = 0;
  let err = 0;
  for (const r of results) {
    if (r === 'ok') ok++;
    else if (r === 'mismatch') mismatch++;
    else err++;
  }
  console.log(
    `[verify-stt] Done. ok=${ok} mismatch=${mismatch} error=${err} (total=${entries.length})`
  );
  return mismatch > 0 || err > 0 ? 1 : 0;
}

function logMismatch(entry: ManifestEntry, got: string): void {
  console.error(
    `[verify-stt] MISMATCH order=${entry.order} id=${entry.id} file=${entry.localFile}`
  );
  console.error(`  expected: ${entry.text}`);
  console.error(`  got:      ${got === '' ? '(empty)' : got}`);
}
