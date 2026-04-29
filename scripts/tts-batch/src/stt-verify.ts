import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyMp3BufferMatchesTranscript } from '@ai-spanish/audio-verify';

import { createJobQueue } from './queue.js';
import { readManifest } from './writer.js';
import type { ManifestEntry } from './types.js';

/**
 * @returns 0 if all pass, 1 if any mismatch or I/O / API error.
 */
export async function runVerifyStt(outDir: string, apiKey: string): Promise<number> {
  const { entries } = await readManifest(outDir);
  const limit = createJobQueue();
  const tasks = entries.map((entry) =>
    limit(async (): Promise<'ok' | 'mismatch' | 'error'> => {
      if (entry.text.trim().length <= 1) {
        console.warn(
          `[verify-stt] SKIP index=${entry.index} id=${entry.id} file=${entry.localFile} — expected text is too short for reliable STT; not scored`
        );
        return 'ok';
      }
      const abs = path.join(outDir, entry.localFile);
      let buf: Buffer;
      try {
        buf = await fs.readFile(abs);
      } catch {
        console.error(
          `[verify-stt] ERROR index=${entry.index} id=${entry.id} file=${entry.localFile} — missing or unreadable: ${abs}`
        );
        return 'error';
      }
      const r = await verifyMp3BufferMatchesTranscript(
        buf,
        entry.text,
        entry.language,
        apiKey
      );
      if (!r.ok && r.kind === 'api') {
        console.error(
          `[verify-stt] ERROR index=${entry.index} id=${entry.id} file=${entry.localFile} — Deepgram: ${r.message}`
        );
        return 'error';
      }
      if (r.ok) {
        return 'ok';
      }
      logMismatch(entry, r.transcript);
      return 'mismatch';
    })
  );
  const results = await Promise.all(tasks);
  let ok = 0;
  let mismatch = 0;
  let err = 0;
  for (const row of results) {
    if (row === 'ok') ok++;
    else if (row === 'mismatch') mismatch++;
    else err++;
  }
  console.log(
    `[verify-stt] Done. ok=${ok} mismatch=${mismatch} error=${err} (total=${entries.length})`
  );
  return mismatch > 0 || err > 0 ? 1 : 0;
}

function logMismatch(entry: ManifestEntry, got: string): void {
  console.error(
    `[verify-stt] MISMATCH index=${entry.index} id=${entry.id} file=${entry.localFile}`
  );
  console.error(`  expected: ${entry.text}`);
  console.error(`  got:      ${got === '' ? '(empty)' : got}`);
}
