import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const FADE_OUT_DURATION_S = 0.05;
const TRIM_END_S = 0.005;

/** Run a command, resolve on exit 0, reject with stderr on non-zero. */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(new Error(`Failed to start ${cmd}: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${cmd} exited ${code}:\n${stderr.trim()}`));
      }
    });
  });
}

/**
 * Returns duration of an audio file in seconds using ffprobe.
 * Requires ffprobe on PATH (installed with ffmpeg).
 */
export async function getAudioDurationSeconds(filePath: string): Promise<number> {
  const out = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const d = parseFloat(out);
  if (!Number.isFinite(d) || d < 0) {
    throw new Error(`ffprobe returned unexpected duration "${out}" for ${filePath}`);
  }
  return d;
}

/**
 * Applies a 50 ms fade-out and trims the last ~5 ms from the given MP3.
 * Operates in-place: writes to a temp file then atomically renames.
 *
 * If the clip is too short to fade without clamping, the fade duration is
 * shortened so it never exceeds (duration - TRIM_END_S).
 */
export async function postProcessMp3(filePath: string): Promise<void> {
  const duration = await getAudioDurationSeconds(filePath);

  const usableDuration = Math.max(0, duration - TRIM_END_S);
  const fadeDuration = Math.min(FADE_OUT_DURATION_S, usableDuration);

  if (fadeDuration <= 0) {
    console.warn(
      `  [ffmpeg] ${path.basename(filePath)}: clip too short to fade (${duration.toFixed(3)}s), skipping post-process`,
    );
    return;
  }

  const fadeStart = usableDuration - fadeDuration;
  const trimEnd = duration - TRIM_END_S;

  const filter = `afade=t=out:st=${fadeStart.toFixed(6)}:d=${fadeDuration.toFixed(6)},atrim=end=${trimEnd.toFixed(6)}`;

  const tmpFile = path.join(os.tmpdir(), `tts-pp-${Date.now()}-${path.basename(filePath)}`);
  try {
    await run('ffmpeg', [
      '-y',
      '-i',
      filePath,
      '-af',
      filter,
      '-c:a',
      'libmp3lame',
      '-q:a',
      '2',
      tmpFile,
    ]);
    await fs.rename(tmpFile, filePath);
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => undefined);
    throw err;
  }
}
