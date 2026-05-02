#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadScriptsEnv } from '../../load-scripts-env.js';

import { buildTtsJobs } from './parser.js';
import { createJobQueue, withRetry } from './queue.js';
import { synthesizeToBuffer } from './tts-client.js';
import type {
  CliOptions,
  ManifestEntry,
  S3PathConfig,
  TranscriptCliSource,
  TtsJob,
} from './types.js';
import { uploadToS3 } from './uploader.js';
import {
  audioFileExists,
  audioRelativePath,
  buildManifestEntry,
  computeJobHash,
  ensureDir,
  ensureS3Keys,
  normalizeAudioContentPrefix,
  normalizeLessonSegment,
  readHashCache,
  readManifest,
  s3ManifestObjectKey,
  writeAudioFile,
  writeHashCache,
  writeManifest,
} from './writer.js';
import { runVerifyLoudness } from './verify-loudness.js';
import { runVerifyStt } from './stt-verify.js';
import { loadTranscriptFromSupabase } from './load-transcript-supabase.js';

import {
  isTranscriptLessonIdSyntaxValid,
  parseLessonFileJson,
  type Phrase,
} from '@ai-spanish/logic';

loadScriptsEnv();

const DEFAULT_OUT = path.resolve(process.cwd(), 'output');

function resolveTranscriptSource(args: string[]): TranscriptCliSource {
  let inputFromCli: string | undefined;
  let transcriptLessonCli: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input' || a === '-i') {
      inputFromCli = path.resolve(process.cwd(), args[++i] ?? '');
    } else if (a === '--transcript-lesson') {
      transcriptLessonCli = (args[++i] ?? '').trim();
    }
  }

  const envInput = process.env.TRANSCRIPT_INPUT?.trim();
  const filePath =
    inputFromCli ??
    (envInput ? path.resolve(process.cwd(), envInput) : undefined);

  const dbLesson =
    transcriptLessonCli ||
    process.env.TRANSCRIPT_LESSON_ID?.trim() ||
    undefined;

  if (filePath && dbLesson) {
    throw new Error(
      'Use either a file transcript (--input / TRANSCRIPT_INPUT) or Supabase (--transcript-lesson / TRANSCRIPT_LESSON_ID), not both.',
    );
  }

  if (filePath) {
    return { source: 'file', path: filePath };
  }

  if (dbLesson) {
    if (!isTranscriptLessonIdSyntaxValid(dbLesson)) {
      throw new Error(
        '--transcript-lesson / TRANSCRIPT_LESSON_ID must be a positive integer string without leading zeros (e.g. 1, 12).',
      );
    }
    return { source: 'supabase', lessonId: dbLesson };
  }

  throw new Error(
    'No transcript source: pass --input PATH, set TRANSCRIPT_INPUT, or use --transcript-lesson <id> (or TRANSCRIPT_LESSON_ID) with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
  );
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let outDir = DEFAULT_OUT;
  let bucket: string | undefined = process.env.S3_BUCKET_NAME;
  let force = false;
  let localOnly = false;
  let uploadOnly = false;
  let lesson: string | undefined;
  let noAudioPos = false;
  let verifyStt = false;
  let verifyLoudness = false;
  let onlyPhrase: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input' || a === '-i') {
      args[++i];
    } else if (a === '--transcript-lesson') {
      args[++i];
    } else if (a === '--out' || a === '-o') {
      outDir = path.resolve(process.cwd(), args[++i] ?? '');
    } else if (a === '--bucket' || a === '-b') {
      bucket = args[++i];
    } else if (a === '--lesson') {
      lesson = args[++i];
    } else if (a === '--force') {
      force = true;
    } else if (a === '--local-only') {
      localOnly = true;
    } else if (a === '--upload-only') {
      uploadOnly = true;
    } else if (a === '--verify-stt') {
      verifyStt = true;
    } else if (a === '--verify-loudness') {
      verifyLoudness = true;
    } else if (a === '--only-phrase') {
      const raw = (args[++i] ?? '').trim();
      if (!/^\d+$/.test(raw)) {
        throw new Error(`--only-phrase requires a non-negative integer (got: ${raw || '(empty)'})`);
      }
      onlyPhrase = parseInt(raw, 10);
    } else if (a === '--no-audio-pos') {
      noAudioPos = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  const transcriptSource =
    uploadOnly || verifyStt || verifyLoudness
      ? null
      : resolveTranscriptSource(args);

  return {
    transcriptSource,
    outDir,
    bucket,
    force,
    localOnly,
    uploadOnly,
    lesson,
    noAudioPos,
    verifyStt,
    verifyLoudness,
    onlyPhrase,
  };
}

/** CLI --lesson overrides S3_LESSON env. */
function resolveS3PathConfig(opts: CliOptions): S3PathConfig {
  const prefix = normalizeAudioContentPrefix(process.env.AUDIO_CONTENT_PREFIX);
  const lesson = normalizeLessonSegment(opts.lesson ?? process.env.S3_LESSON);
  return { prefix, lesson };
}

function printHelp(): void {
  console.log(`
TTS batch — Deepgram TTS from transcript JSON or Supabase

Usage:
  npm run tts:batch -- [options]

Options:
  --input, -i        Path to transcript JSON (or set TRANSCRIPT_INPUT)
  --transcript-lesson  Lesson id stored in Supabase (1 or 2); alternative to --input. Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or set TRANSCRIPT_LESSON_ID instead of this flag)
  --out, -o       Output directory (default: ./output)
  --bucket, -b    S3 bucket name (default: S3_BUCKET_NAME env)
  --force         Regenerate all audio (ignore cache)
  --local-only    Write audio + manifest to disk only; skip S3 (no AWS credentials needed)
  --upload-only   Upload existing manifest + audio from --out to S3; no Deepgram (no DEEPGRAM_API_KEY)
  --verify-stt     Prerecorded STT (Deepgram) + keyword bias; also runs --verify-loudness first. exit 1 if either fails
  --verify-loudness  ffmpeg volumedetect: peak + mean floors (use alone or redundant with --verify-stt)
  --only-phrase   Regenerate only clips for this phrase's transcript "index" (JSON field); merge into manifest; needs prior full run
  --lesson        Optional folder under AUDIO_CONTENT_PREFIX (overrides S3_LESSON), e.g. lesson1
  --no-audio-pos  Skip ffmpeg post-processing (50 ms fade-out + 5 ms tail trim); write raw Deepgram output (requires no ffmpeg)
  --help, -h      Show this help

Examples:
  npm run tts:batch -- --upload-only --bucket my-bucket
  npm run tts:batch -- --upload-only --out ./output --bucket my-bucket --lesson lesson1
  npm run tts:batch -- --local-only --only-phrase 11 --out ./output --transcript-lesson 1

Environment:
  DEEPGRAM_API_KEY        Required unless --upload-only; required for --verify-stt (not for --verify-loudness alone)
  TTS_VERIFY_LOUDNESS_MIN_MAX_DB  Optional; max_volume floor in dB (default -30; peak must be >= this)
  TTS_VERIFY_LOUDNESS_MIN_MEAN_DB  Optional; mean_volume floor in dB (default -40; mean must be >= this)
  AWS_* / S3_BUCKET_NAME  Required unless --local-only; required for --upload-only
  AUDIO_CONTENT_PREFIX    S3 key prefix (default: audio-content); single segment, e.g. audio-content
  S3_LESSON               Optional lesson segment if --lesson not passed
  TRANSCRIPT_INPUT        Path to transcript JSON file when using --input
  TRANSCRIPT_LESSON_ID    Load transcript from Supabase when no --input / TRANSCRIPT_INPUT (requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

/**
 * Reads non-negative integer transcript `index` from JSON (each phrase object).
 */
function readPhraseIndexFromJson(
  o: Record<string, unknown>,
  label: string,
  fileLabel: string
): number {
  const v = o.index;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
    return v;
  }
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    return parseInt(v.trim(), 10);
  }
  throw new Error(
    `${label}: invalid or missing "index" — must be a non-negative integer (${fileLabel})`
  );
}

async function loadTranscript(inputPath: string): Promise<Phrase[]> {
  const absolutePath = path.resolve(inputPath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in transcript: ${absolutePath}`);
  }
  const fileLabel = absolutePath;
  if (!Array.isArray(data)) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const { phrases } = parseLessonFileJson(data, fileLabel);
      for (let i = 0; i < phrases.length; i++) {
        const item = phrases[i];
        const o = item as Record<string, unknown>;
        const nameHint =
          typeof o.name === 'string' && o.name.trim() !== '' ? ` "${o.name}"` : '';
        const label = `Transcript entry ${i}${nameHint}`;
        readPhraseIndexFromJson(o, label, fileLabel);
      }
      return phrases as Phrase[];
    }
    throw new Error(
      `Transcript must be { meta, phrases } or a JSON array of phrases (${absolutePath})`,
    );
  }
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Transcript entry ${i}: must be an object (${fileLabel})`);
    }
    const o = item as Record<string, unknown>;
    const nameHint =
      typeof o.name === 'string' && o.name.trim() !== '' ? ` "${o.name}"` : '';
    const label = `Transcript entry ${i}${nameHint}`;
    readPhraseIndexFromJson(o, label, fileLabel);
  }
  return data as Phrase[];
}

async function runUploadOnly(opts: CliOptions): Promise<void> {
  if (opts.localOnly) {
    throw new Error('--upload-only cannot be used with --local-only');
  }
  if (opts.force) {
    throw new Error('--upload-only cannot be used with --force');
  }

  requireEnv('AWS_ACCESS_KEY_ID');
  requireEnv('AWS_SECRET_ACCESS_KEY');
  if (!opts.bucket?.trim()) {
    throw new Error('S3 bucket required: set S3_BUCKET_NAME or pass --bucket');
  }

  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const s3Path = resolveS3PathConfig(opts);
  const { entries } = await readManifest(opts.outDir);
  const withKeys = ensureS3Keys(entries, s3Path);
  const manifestKey = s3ManifestObjectKey(s3Path);

  const missing: string[] = [];
  for (const e of withKeys) {
    const abs = path.join(opts.outDir, e.localFile);
    try {
      await fs.access(abs);
    } catch {
      missing.push(abs);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing audio file(s):\n${missing.join('\n')}`);
  }

  const bucketName = opts.bucket.trim();
  console.log(
    `Uploading ${withKeys.length} audio file(s) + ${manifestKey} from ${opts.outDir} to s3://${bucketName}/ ...`
  );
  await uploadToS3({
    bucket: bucketName,
    region,
    outDir: opts.outDir,
    entries: withKeys,
    manifestS3Key: manifestKey,
  });
  console.log('Upload complete.');
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

async function writeBatchOutputs(
  opts: CliOptions,
  outDir: string,
  results: Array<{ job: TtsJob; entry: ManifestEntry; didGenerate: boolean }>,
  previousCache: Record<string, string>,
  region: string,
  s3Path: S3PathConfig
): Promise<void> {
  const nextCache: Record<string, string> = { ...previousCache };
  for (const r of results) {
    if (r.didGenerate) {
      nextCache[r.job.id] = r.entry.hash;
    }
  }
  await writeHashCache(outDir, nextCache);

  const manifestEntries = results.map((r) => r.entry);
  await writeManifest(outDir, manifestEntries);

  const generated = results.filter((r) => r.didGenerate).length;
  const skipped = results.length - generated;
  console.log(`Done. Generated: ${generated}, skipped (cache): ${skipped}`);
  console.log(`Manifest: ${path.join(outDir, 'manifest.json')}`);

  if (!opts.localOnly && opts.bucket) {
    const bucketName = opts.bucket.trim();
    const manifestKey = s3ManifestObjectKey(s3Path);
    console.log(
      `Uploading to s3://${bucketName}/${manifestKey} (and audio keys under same prefix) ...`
    );
    await uploadToS3({
      bucket: bucketName,
      region,
      outDir,
      entries: manifestEntries,
      manifestS3Key: manifestKey,
    });
    console.log('Upload complete.');
  }
}

/**
 * Buffers per-position log messages so concurrent jobs (`p-limit`) emit lines in
 * transcript job order, not completion order. Logs use transcript `index` (phrase-level,
 * repeated for each clip of that phrase).
 */
function createOrderedLogger(total: number): (position: number, message?: string) => void {
  const slots: (string | undefined)[] = new Array(total);
  let nextToFlush = 0;
  return function record(position: number, message?: string): void {
    slots[position] = message ?? '';
    while (nextToFlush < total && slots[nextToFlush] !== undefined) {
      const line = slots[nextToFlush]!;
      if (line.length > 0) console.log(line);
      slots[nextToFlush] = undefined;
      nextToFlush++;
    }
  };
}

/**
 * Regenerate all jobs for `phraseIndex` (matched via `job.index`) and merge with existing manifest.
 */
async function runOnlyPhraseBatch(
  opts: CliOptions,
  allJobs: TtsJob[],
  phraseIndex: number,
  apiKey: string,
  region: string,
  s3Path: S3PathConfig
): Promise<void> {
  const isPhraseJob = (j: TtsJob): boolean => j.index === phraseIndex;
  const toRegen = allJobs.filter(isPhraseJob);
  if (toRegen.length === 0) {
    throw new Error(
      `Phrase index ${phraseIndex} has no TTS fields (all English/Spanish lines for this phrase are empty).`
    );
  }

  const { entries: previous } = await readManifest(opts.outDir);
  const byId = new Map(previous.map((e) => [e.id, e]));

  await ensureDir(opts.outDir);
  const cache = await readHashCache(opts.outDir);
  const limit = createJobQueue();

  console.log(
    `--only-phrase ${phraseIndex}: regenerating ${toRegen.length} clip(s); keeping ${allJobs.length - toRegen.length} from manifest.`
  );

  const recordLog = createOrderedLogger(allJobs.length);

  const tasks = allJobs.map((job, position) =>
    limit(async (): Promise<{ job: TtsJob; entry: ManifestEntry; didGenerate: boolean }> => {
      if (!isPhraseJob(job)) {
        const prev = byId.get(job.id);
        if (!prev) {
          throw new Error(
            `Missing manifest entry for "${job.id}". Run a full tts:batch (without --only-phrase) once, then retry.`
          );
        }
        recordLog(position);
        return { job, entry: prev, didGenerate: false };
      }

      const hash = computeJobHash(job.text, job.voice, opts.noAudioPos);
      const buffer = await withRetry(() => synthesizeToBuffer(job.text, job.language, apiKey));
      const rel = await writeAudioFile(opts.outDir, job, buffer, opts.noAudioPos);
      const createdAt = new Date().toISOString();
      recordLog(position, `  OK index=${job.index} ${job.id}`);
      return {
        job,
        entry: buildManifestEntry(
          job,
          rel,
          hash,
          createdAt,
          !opts.localOnly,
          opts.localOnly ? undefined : s3Path
        ),
        didGenerate: true,
      };
    })
  );

  const results = await Promise.all(tasks);
  await writeBatchOutputs(opts, opts.outDir, results, cache, region, s3Path);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.onlyPhrase !== undefined && opts.uploadOnly) {
    throw new Error('--only-phrase cannot be used with --upload-only');
  }
  if (opts.onlyPhrase !== undefined && opts.verifyStt) {
    throw new Error('--only-phrase cannot be used with --verify-stt');
  }
  if (opts.onlyPhrase !== undefined && opts.verifyLoudness) {
    throw new Error('--only-phrase cannot be used with --verify-loudness');
  }
  if (opts.verifyLoudness && opts.uploadOnly) {
    throw new Error('--verify-loudness cannot be used with --upload-only');
  }

  if (opts.verifyStt && opts.uploadOnly) {
    throw new Error('--verify-stt cannot be used with --upload-only');
  }
  if (opts.verifyStt) {
    const cL = await runVerifyLoudness(opts.outDir);
    const apiKey = requireEnv('DEEPGRAM_API_KEY');
    const cS = await runVerifyStt(opts.outDir, apiKey);
    process.exit(cL !== 0 || cS !== 0 ? 1 : 0);
  }
  if (opts.verifyLoudness) {
    const c = await runVerifyLoudness(opts.outDir);
    process.exit(c);
  }

  if (opts.uploadOnly) {
    await runUploadOnly(opts);
    return;
  }

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
  const s3Path = resolveS3PathConfig(opts);

  if (!opts.transcriptSource) {
    throw new Error('Missing transcript source (internal)');
  }
  const transcriptLabel =
    opts.transcriptSource.source === 'file'
      ? path.resolve(opts.transcriptSource.path)
      : `Supabase lesson_id=${opts.transcriptSource.lessonId}`;
  console.log(`Reading transcript: ${transcriptLabel}`);
  const phrases =
    opts.transcriptSource.source === 'file'
      ? await loadTranscript(opts.transcriptSource.path)
      : await loadTranscriptFromSupabase(opts.transcriptSource.lessonId);
  const jobs = buildTtsJobs(phrases);
  console.log(`Built ${jobs.length} TTS job(s)`);

  if (opts.onlyPhrase !== undefined) {
    if (!phrases.some((p) => p.index === opts.onlyPhrase)) {
      throw new Error(
        `--only-phrase ${opts.onlyPhrase}: no phrase in the transcript has that "index" (see lesson JSON).`
      );
    }
    await runOnlyPhraseBatch(opts, jobs, opts.onlyPhrase, apiKey, region, s3Path);
    return;
  }

  await ensureDir(opts.outDir);
  const cache = await readHashCache(opts.outDir);

  const limit = createJobQueue();
  const recordLog = createOrderedLogger(jobs.length);

  const tasks = jobs.map((job, position) =>
    limit(async (): Promise<{ job: TtsJob; entry: ManifestEntry; didGenerate: boolean }> => {
      const hash = computeJobHash(job.text, job.voice, opts.noAudioPos);
      const skip = await shouldSkipJob(job, hash, opts.force, cache, opts.outDir);
      if (skip) {
        const createdAt = new Date().toISOString();
        recordLog(position);
        return {
          job,
          entry: buildManifestEntry(
            job,
            audioRelativePath(job.id),
            hash,
            createdAt,
            !opts.localOnly,
            opts.localOnly ? undefined : s3Path
          ),
          didGenerate: false,
        };
      }

      const buffer = await withRetry(() =>
        synthesizeToBuffer(job.text, job.language, apiKey)
      );
      const rel = await writeAudioFile(opts.outDir, job, buffer, opts.noAudioPos);
      const createdAt = new Date().toISOString();
      recordLog(position, `  OK index=${job.index} ${job.id}`);
      return {
        job,
        entry: buildManifestEntry(
          job,
          rel,
          hash,
          createdAt,
          !opts.localOnly,
          opts.localOnly ? undefined : s3Path
        ),
        didGenerate: true,
      };
    })
  );

  const results = await Promise.all(tasks);
  await writeBatchOutputs(opts, opts.outDir, results, cache, region, s3Path);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
