import { spawn } from 'node:child_process';

const DEFAULT_MIN_MAX_DB = -30;
const DEFAULT_MIN_MEAN_DB = -40;

/** Parse `TTS_VERIFY_LOUDNESS_MIN_MAX_DB` (default -30). Peak must be >= this. */
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

/** Parse `TTS_VERIFY_LOUDNESS_MIN_MEAN_DB` (default -40). Mean must be >= this. */
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
export function analyzeLoudnessFile(absPath: string): Promise<{ meanDb: number; maxDb: number }> {
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
