import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Language } from '@ai-spanish/logic';
import {
  buildS3AudioKey,
  DEFAULT_AUDIO_CONTENT_PREFIX,
  normalizeAudioContentPrefix,
  normalizeLessonSegment,
} from '@ai-spanish/logic';

import { postProcessMp3 } from './ffmpeg-post.js';
import type { ManifestEntry, S3PathConfig, TtsJob } from './types.js';

export { DEFAULT_AUDIO_CONTENT_PREFIX, normalizeAudioContentPrefix, normalizeLessonSegment };

const MANIFEST_FILE = 'manifest.json';

function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'es';
}

/** S3 object key for one mp3 under {base}/audio/{jobId}.mp3 */
export function s3AudioObjectKey(jobId: string, config: S3PathConfig): string {
  return buildS3AudioKey(config.prefix, config.lesson, jobId);
}

/** S3 object key for manifest.json under the lesson (or prefix) folder. */
export function s3ManifestObjectKey(config: S3PathConfig): string {
  const base = config.lesson
    ? path.posix.join(config.prefix, config.lesson)
    : config.prefix;
  return path.posix.join(base, MANIFEST_FILE);
}

/**
 * Identifies the current post-processing pipeline so that toggling
 * --no-audio-pos or changing the fade/trim parameters busts the cache.
 */
const AUDIO_PP_VERSION = 'audio-pp-v1:fade50ms+trim5ms';

/**
 * Deterministic hash for cache invalidation: same text + voice → same hash.
 * Pass `noAudioPos: true` when post-processing is skipped so raw and processed
 * outputs never share a cache entry.
 */
export function computeJobHash(text: string, voice: string, noAudioPos = false): string {
  const h = createHash('sha256');
  h.update(text, 'utf8');
  h.update('|', 'utf8');
  h.update(voice, 'utf8');
  h.update('|', 'utf8');
  h.update(noAudioPos ? 'raw' : AUDIO_PP_VERSION, 'utf8');
  return `sha256:${h.digest('hex')}`;
}

/** Relative POSIX path from output root, e.g. audio/0-en-first-intro.mp3 */
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
  buffer: ArrayBuffer,
  noAudioPos = false
): Promise<string> {
  const rel = audioRelativePath(job.id);
  const abs = path.join(outDir, rel);
  await ensureDir(path.dirname(abs));
  await fs.writeFile(abs, Buffer.from(buffer));
  if (!noAudioPos) {
    await postProcessMp3(abs);
  }
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

/** Leading integer in `{index}-{lang}-{field}` ids (same as the audio file prefix). */
export function phraseOrderFromJobId(jobId: string): number {
  const m = /^(\d+)-/.exec(jobId);
  if (!m) {
    throw new Error(`Invalid TTS job id (expected "{index}-…"): ${jobId}`);
  }
  return parseInt(m[1]!, 10);
}

export function buildManifestEntry(
  job: TtsJob,
  relPath: string,
  hash: string,
  createdAt: string,
  includeS3Key: boolean,
  s3Path?: S3PathConfig
): ManifestEntry {
  const entry: ManifestEntry = {
    id: job.id,
    order: phraseOrderFromJobId(job.id),
    language: job.language,
    text: job.text,
    voice: job.voice,
    localFile: relPath.replace(/\\/g, '/'),
    hash,
    createdAt,
  };
  if (includeS3Key) {
    if (!s3Path) {
      throw new Error('s3Path is required when includeS3Key is true');
    }
    entry.s3Key = s3AudioObjectKey(job.id, s3Path);
  }
  return entry;
}

/**
 * Sets s3Key on every entry from the current layout (overwrites stale keys from older runs).
 */
export function ensureS3Keys(entries: ManifestEntry[], s3Path: S3PathConfig): ManifestEntry[] {
  return entries.map((e) => ({
    ...e,
    s3Key: s3AudioObjectKey(e.id, s3Path),
  }));
}

function requireString(o: Record<string, unknown>, key: string, label: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`${label}: missing or invalid string "${key}"`);
  }
  return v;
}

/**
 * Reads and validates output/manifest.json written by writeManifest.
 */
export async function readManifest(outDir: string): Promise<{
  generatedAt?: string;
  entries: ManifestEntry[];
}> {
  const manifestPath = path.join(outDir, MANIFEST_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    throw new Error(
      `Cannot read ${manifestPath}. Run a batch first (e.g. npm run tts:batch -- --local-only).`
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${manifestPath}`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('manifest.json must be a JSON object');
  }

  const root = data as Record<string, unknown>;
  const entriesRaw = root.entries;

  if (!Array.isArray(entriesRaw)) {
    throw new Error('manifest.json must include a non-empty "entries" array');
  }

  if (entriesRaw.length === 0) {
    throw new Error(
      'manifest.json "entries" is empty. Run a batch generation first (without --upload-only).'
    );
  }

  const entries: ManifestEntry[] = [];
  for (let i = 0; i < entriesRaw.length; i++) {
    const row = entriesRaw[i];
    const label = `manifest entries[${i}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`${label}: must be an object`);
    }
    const o = row as Record<string, unknown>;
    const id = requireString(o, 'id', label);
    const language = o.language;
    if (!isLanguage(language)) {
      throw new Error(`${label}: "language" must be "en" or "es"`);
    }
    const text = requireString(o, 'text', label);
    const voice = requireString(o, 'voice', label);
    const localFile = requireString(o, 'localFile', label);
    const hash = requireString(o, 'hash', label);
    const createdAt = requireString(o, 'createdAt', label);
    const s3Key = o.s3Key;
    const orderRaw = o.order;
    const order =
      typeof orderRaw === 'number' && Number.isInteger(orderRaw)
        ? orderRaw
        : phraseOrderFromJobId(id);
    const entry: ManifestEntry = {
      id,
      order,
      language,
      text,
      voice,
      localFile,
      hash,
      createdAt,
    };
    if (s3Key !== undefined) {
      if (typeof s3Key !== 'string' || s3Key.trim() === '') {
        throw new Error(`${label}: invalid optional "s3Key"`);
      }
      entry.s3Key = s3Key;
    }
    entries.push(entry);
  }

  return {
    generatedAt: typeof root.generatedAt === 'string' ? root.generatedAt : undefined,
    entries,
  };
}

export async function writeManifest(outDir: string, entries: ManifestEntry[]): Promise<void> {
  const payload = {
    generatedAt: new Date().toISOString(),
    entries,
  };
  await fs.writeFile(
    path.join(outDir, MANIFEST_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );
}

export { MANIFEST_FILE };
