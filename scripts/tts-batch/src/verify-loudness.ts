import fs from 'node:fs/promises';
import path from 'node:path';

import {
  analyzeLoudnessFile,
  resolveMinMaxDbFromEnv,
  resolveMinMeanDbFromEnv,
} from '@ai-spanish/audio-verify';

import { createJobQueue } from './queue.js';
import { readManifest } from './writer.js';

/**
 * @returns 0 if all pass, 1 if any too-quiet / error / parse failure
 */
export async function runVerifyLoudness(
  outDir: string,
  options?: { minMaxDb?: number; minMeanDb?: number }
): Promise<number> {
  const minMaxDb = options?.minMaxDb ?? resolveMinMaxDbFromEnv();
  const minMeanDb = options?.minMeanDb ?? resolveMinMeanDbFromEnv();
  const { entries } = await readManifest(outDir);
  const limit = createJobQueue();

  const tasks = entries.map((entry) =>
    limit(async (): Promise<'ok' | 'skip' | 'too_quiet' | 'error'> => {
      if (entry.text.trim().length <= 1) {
        console.warn(
          `[verify-loudness] SKIP index=${entry.index} id=${entry.id} file=${entry.localFile} — expected text is too short; not scored`
        );
        return 'skip';
      }
      const abs = path.join(outDir, entry.localFile);
      try {
        await fs.access(abs);
      } catch {
        console.error(
          `[verify-loudness] ERROR index=${entry.index} id=${entry.id} file=${entry.localFile} — missing: ${abs}`
        );
        return 'error';
      }
      let stats: { meanDb: number; maxDb: number };
      try {
        stats = await analyzeLoudnessFile(abs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `[verify-loudness] ERROR index=${entry.index} id=${entry.id} file=${entry.localFile} — ${msg}`
        );
        return 'error';
      }
      if (stats.maxDb < minMaxDb) {
        console.error(
          `[verify-loudness] TOO_QUIET index=${entry.index} id=${entry.id} file=${entry.localFile} (peak)`
        );
        console.error(
          `  max_volume=${stats.maxDb.toFixed(1)} dB (mean=${stats.meanDb.toFixed(1)} dB) — need max >= ${minMaxDb} dB (TTS_VERIFY_LOUDNESS_MIN_MAX_DB)`
        );
        return 'too_quiet';
      }
      if (stats.meanDb < minMeanDb) {
        console.error(
          `[verify-loudness] TOO_QUIET index=${entry.index} id=${entry.id} file=${entry.localFile} (mean)`
        );
        console.error(
          `  mean_volume=${stats.meanDb.toFixed(1)} dB (max=${stats.maxDb.toFixed(1)} dB) — need mean >= ${minMeanDb} dB (TTS_VERIFY_LOUDNESS_MIN_MEAN_DB)`
        );
        return 'too_quiet';
      }
      return 'ok';
    })
  );

  const results = await Promise.all(tasks);
  let ok = 0;
  let skip = 0;
  let too = 0;
  let err = 0;
  for (const r of results) {
    if (r === 'ok') ok++;
    else if (r === 'skip') skip++;
    else if (r === 'too_quiet') too++;
    else err++;
  }
  console.log(
    `[verify-loudness] Done. ok=${ok} too_quiet=${too} skip=${skip} error=${err} (total=${entries.length}) need max>=${minMaxDb} dB and mean>=${minMeanDb} dB`
  );
  return too > 0 || err > 0 ? 1 : 0;
}
