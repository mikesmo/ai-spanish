#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { buildTtsJobs } from './parser.js';
import { createJobQueue, withRetry } from './queue.js';
import { synthesizeToBuffer } from './tts-client.js';
import type { CliOptions, ManifestEntry, TtsJob } from './types.js';
import { uploadToS3 } from './uploader.js';
import {
  audioFileExists,
  audioRelativePath,
  buildManifestEntry,
  computeJobHash,
  ensureDir,
  readHashCache,
  writeAudioFile,
  writeHashCache,
  writeManifest,
} from './writer.js';

import type { Phrase } from '@ai-spanish/logic';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PACKAGE_ROOT, '.env') });
dotenv.config();

const DEFAULT_INPUT = path.resolve(
  process.cwd(),
  'packages/logic/assets/transcript.json'
);
const DEFAULT_OUT = path.resolve(process.cwd(), 'output');

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let inputPath = DEFAULT_INPUT;
  let outDir = DEFAULT_OUT;
  let bucket: string | undefined = process.env.S3_BUCKET_NAME;
  let force = false;
  let localOnly = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input' || a === '-i') {
      inputPath = path.resolve(process.cwd(), args[++i] ?? '');
    } else if (a === '--out' || a === '-o') {
      outDir = path.resolve(process.cwd(), args[++i] ?? '');
    } else if (a === '--bucket' || a === '-b') {
      bucket = args[++i];
    } else if (a === '--force') {
      force = true;
    } else if (a === '--local-only') {
      localOnly = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return { inputPath, outDir, bucket, force, localOnly };
}

function printHelp(): void {
  console.log(`
TTS batch — Deepgram TTS from transcript.json

Usage:
  npm run tts:batch -- [options]

Options:
  --input, -i   Path to transcript JSON (default: packages/logic/assets/transcript.json from cwd)
  --out, -o     Output directory (default: ./output)
  --bucket, -b  S3 bucket name (default: S3_BUCKET_NAME env)
  --force       Regenerate all audio (ignore cache)
  --local-only  Write audio + manifest to disk only; skip S3 (no AWS credentials needed)
  --help, -h    Show this help

Environment:
  DEEPGRAM_API_KEY     Required
  AWS_* / S3_BUCKET_NAME  Required unless --local-only
`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

async function loadTranscript(inputPath: string): Promise<Phrase[]> {
  const raw = await fs.readFile(inputPath, 'utf8');
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data)) {
    throw new Error('Transcript must be a JSON array of phrases');
  }
  return data as Phrase[];
}

async function shouldSkipJob(
  job: TtsJob,
  hash: string,
  force: boolean,
  cache: Record<string, string>,
  outDir: string
): Promise<boolean> {
  if (force) return false;
  if (cache[job.id] !== hash) return false;
  return audioFileExists(outDir, job.id);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  requireEnv('DEEPGRAM_API_KEY');
  if (!opts.localOnly) {
    requireEnv('AWS_ACCESS_KEY_ID');
    requireEnv('AWS_SECRET_ACCESS_KEY');
    if (!opts.bucket?.trim()) {
      throw new Error('S3 bucket required: set S3_BUCKET_NAME or pass --bucket');
    }
  }

  const apiKey = process.env.DEEPGRAM_API_KEY!.trim();
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';

  console.log(`Reading ${opts.inputPath}`);
  const phrases = await loadTranscript(opts.inputPath);
  const jobs = buildTtsJobs(phrases);
  console.log(`Built ${jobs.length} TTS job(s)`);

  await ensureDir(opts.outDir);
  const cache = await readHashCache(opts.outDir);

  const limit = createJobQueue();

  const tasks = jobs.map((job) =>
    limit(async (): Promise<{ job: TtsJob; entry: ManifestEntry; didGenerate: boolean }> => {
      const hash = computeJobHash(job.text, job.voice);
      const skip = await shouldSkipJob(job, hash, opts.force, cache, opts.outDir);
      if (skip) {
        const createdAt = new Date().toISOString();
        return {
          job,
          entry: buildManifestEntry(
            job,
            audioRelativePath(job.id),
            hash,
            createdAt,
            !opts.localOnly
          ),
          didGenerate: false,
        };
      }

      const buffer = await withRetry(() =>
        synthesizeToBuffer(job.text, job.language, apiKey)
      );
      const rel = await writeAudioFile(opts.outDir, job, buffer);
      const createdAt = new Date().toISOString();
      console.log(`  OK ${job.id}`);
      return {
        job,
        entry: buildManifestEntry(job, rel, hash, createdAt, !opts.localOnly),
        didGenerate: true,
      };
    })
  );

  const results = await Promise.all(tasks);

  const nextCache: Record<string, string> = { ...cache };
  for (const r of results) {
    if (r.didGenerate) {
      nextCache[r.job.id] = r.entry.hash;
    }
  }
  await writeHashCache(opts.outDir, nextCache);

  const manifestEntries = results.map((r) => r.entry).sort((a, b) => a.id.localeCompare(b.id));
  await writeManifest(opts.outDir, manifestEntries);

  const generated = results.filter((r) => r.didGenerate).length;
  const skipped = results.length - generated;
  console.log(`Done. Generated: ${generated}, skipped (cache): ${skipped}`);
  console.log(`Manifest: ${path.join(opts.outDir, 'manifest.json')}`);

  if (!opts.localOnly && opts.bucket) {
    console.log(`Uploading to s3://${opts.bucket}/ ...`);
    await uploadToS3({
      bucket: opts.bucket.trim(),
      region,
      outDir: opts.outDir,
      entries: manifestEntries,
    });
    console.log('Upload complete.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
