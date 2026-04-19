import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { ManifestEntry, TtsJob } from './types.js';

const MANIFEST_FILE = 'manifest.json';

/**
 * Deterministic hash for cache invalidation: same text + voice → same hash.
 */
export function computeJobHash(text: string, voice: string): string {
  const h = createHash('sha256');
  h.update(text, 'utf8');
  h.update('|', 'utf8');
  h.update(voice, 'utf8');
  return `sha256:${h.digest('hex')}`;
}

/** Relative POSIX path from output root, e.g. audio/0-en-intro.mp3 */
export function audioRelativePath(jobId: string): string {
  return path.posix.join('audio', `${jobId}.mp3`);
}

export function cacheDir(outDir: string): string {
  return path.join(outDir, '.cache');
}

export function cacheHashesPath(outDir: string): string {
  return path.join(cacheDir(outDir), 'hashes.json');
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readHashCache(outDir: string): Promise<Record<string, string>> {
  const p = cacheHashesPath(outDir);
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // missing or invalid
  }
  return {};
}

export async function writeHashCache(
  outDir: string,
  cache: Record<string, string>
): Promise<void> {
  await ensureDir(cacheDir(outDir));
  const p = cacheHashesPath(outDir);
  await fs.writeFile(p, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

export async function writeAudioFile(
  outDir: string,
  job: TtsJob,
  buffer: ArrayBuffer
): Promise<string> {
  const rel = audioRelativePath(job.id);
  const abs = path.join(outDir, rel);
  await ensureDir(path.dirname(abs));
  await fs.writeFile(abs, Buffer.from(buffer));
  return rel;
}

export async function audioFileExists(outDir: string, jobId: string): Promise<boolean> {
  const abs = path.join(outDir, audioRelativePath(jobId));
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

export function buildManifestEntry(
  job: TtsJob,
  relPath: string,
  hash: string,
  createdAt: string,
  includeS3Key: boolean
): ManifestEntry {
  const entry: ManifestEntry = {
    id: job.id,
    language: job.language,
    text: job.text,
    voice: job.voice,
    localFile: relPath.replace(/\\/g, '/'),
    hash,
    createdAt,
  };
  if (includeS3Key) {
    entry.s3Key = path.posix.join('tts', job.language, `${job.id}.mp3`);
  }
  return entry;
}

export async function writeManifest(outDir: string, entries: ManifestEntry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const payload = {
    generatedAt: new Date().toISOString(),
    entries: sorted,
  };
  await fs.writeFile(
    path.join(outDir, MANIFEST_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );
}

export { MANIFEST_FILE };
