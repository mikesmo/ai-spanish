import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { createJobQueue } from './queue.js';
import { readManifest } from './writer.js';

const DEFAULT_MIN_MAX_DB = -30;
const DEFAULT_MIN_MEAN_DB = -40;

/** Parse `TTS_VERIFY_LOUDNESS_MIN_MAX_DB` (default -30). Peak must be >= this (e.g. -20 passes, -50 fails). */
export function resolveMinMaxDbFromEnv(): number {
  const raw = process.env.TTS_VERIFY_LOUDNESS_MIN_MAX_DB?.trim();
  if (!raw) return DEFAULT_MIN_MAX_DB;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) {
    throw new Error(
      `Invalid TTS_VERIFY_LOUDNESS_MIN_MAX_DB: ${raw} (expected a number, e.g. -30)`
    );
  }
  return n;
}

/** Parse `TTS_VERIFY_LOUDNESS_MIN_MEAN_DB` (default -40). Mean must be >= this (e.g. -35 passes, -45 fails). */
export function resolveMinMeanDbFromEnv(): number {
  const raw = process.env.TTS_VERIFY_LOUDNESS_MIN_MEAN_DB?.trim();
  if (!raw) return DEFAULT_MIN_MEAN_DB;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) {
    throw new Error(
      `Invalid TTS_VERIFY_LOUDNESS_MIN_MEAN_DB: ${raw} (expected a number, e.g. -40)`
    );
  }
  return n;
}

/**
 * Run ffmpeg volumedetect; stats are on stderr. Resolves on exit 0 with parsed dB values.
 */
function runVolumedetect(absPath: string): Promise<{ meanDb: number; maxDb: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-i', absPath, '-af', 'volumedetect', '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      reject(
        new Error(
          `Failed to start ffmpeg: ${err.message}. Is ffmpeg on PATH? (e.g. brew install ffmpeg)`
        )
      );
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code} for ${absPath}:\n${stderr.trim()}`));
        return;
      }
      const maxM = /max_volume:\s*([-\d.]+)\s*dB/i.exec(stderr);
      const meanM = /mean_volume:\s*([-\d.]+)\s*dB/i.exec(stderr);
      if (!maxM) {
        reject(new Error(`Could not parse max_volume from ffmpeg stderr for ${absPath}`));
        return;
      }
      if (!meanM) {
        reject(new Error(`Could not parse mean_volume from ffmpeg stderr for ${absPath}`));
        return;
      }
      const maxDb = parseFloat(maxM[1]!);
      const meanDb = parseFloat(meanM[1]!);
      if (!Number.isFinite(maxDb) || !Number.isFinite(meanDb)) {
        reject(new Error(`Invalid max/mean volume values for ${absPath}`));
        return;
      }
      resolve({ meanDb, maxDb });
    });
  });
}

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
          `[verify-loudness] SKIP order=${entry.order} id=${entry.id} file=${entry.localFile} — expected text is too short; not scored`
        );
        return 'skip';
      }
      const abs = path.join(outDir, entry.localFile);
      try {
        await fs.access(abs);
      } catch {
        console.error(
          `[verify-loudness] ERROR order=${entry.order} id=${entry.id} file=${entry.localFile} — missing: ${abs}`
        );
        return 'error';
      }
      let stats: { meanDb: number; maxDb: number };
      try {
        stats = await runVolumedetect(abs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `[verify-loudness] ERROR order=${entry.order} id=${entry.id} file=${entry.localFile} — ${msg}`
        );
        return 'error';
      }
      if (stats.maxDb < minMaxDb) {
        console.error(
          `[verify-loudness] TOO_QUIET order=${entry.order} id=${entry.id} file=${entry.localFile} (peak)`
        );
        console.error(
          `  max_volume=${stats.maxDb.toFixed(1)} dB (mean=${stats.meanDb.toFixed(1)} dB) — need max >= ${minMaxDb} dB (TTS_VERIFY_LOUDNESS_MIN_MAX_DB)`
        );
        return 'too_quiet';
      }
      if (stats.meanDb < minMeanDb) {
        console.error(
          `[verify-loudness] TOO_QUIET order=${entry.order} id=${entry.id} file=${entry.localFile} (mean)`
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
