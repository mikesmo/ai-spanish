#!/usr/bin/env node
/**
 * One-time migration: legacy `{phrase}-answer-slow` (0.9×) → `{phrase}-answer-medium`
 * (copy bytes), then regenerate `{phrase}-answer-slow` at 0.7×. Updates manifest.json,
 * hash cache, optional S3 upload (same layout as `tts:batch`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadScriptsEnv } from '../../load-scripts-env.js';

import { withRetry } from './queue.js';
import { getVoiceForLanguage, synthesizeToBuffer } from './tts-client.js';
import type { ManifestEntry, S3PathConfig, TranscriptCliSource, TtsJob } from './types.js';
import { uploadToS3 } from './uploader.js';
import {
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
import { loadTranscriptFromSupabase } from './load-transcript-supabase.js';

import {
  isTranscriptLessonIdSyntaxValid,
  parseLessonFileJson,
  s3LessonFolderForTranscriptLessonId,
  type Phrase,
} from '@ai-spanish/logic';

loadScriptsEnv();

const SLOW_SUFFIX = '-answer-slow';
const MEDIUM_SUFFIX = '-answer-medium';

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
    inputFromCli ?? (envInput ? path.resolve(process.cwd(), envInput) : undefined);

  const dbLesson =
    transcriptLessonCli || process.env.TRANSCRIPT_LESSON_ID?.trim() || undefined;

  if (filePath && dbLesson) {
    throw new Error('Use either --input or --transcript-lesson / TRANSCRIPT_LESSON_ID, not both.');
  }

  if (filePath) {
    return { source: 'file', path: filePath };
  }

  if (dbLesson) {
    if (!isTranscriptLessonIdSyntaxValid(dbLesson)) {
      throw new Error(
        '--transcript-lesson must be a positive integer string without leading zeros.',
      );
    }
    return { source: 'supabase', lessonId: dbLesson };
  }

  throw new Error(
    'Pass --input PATH or --transcript-lesson <id> (or TRANSCRIPT_INPUT / TRANSCRIPT_LESSON_ID).',
  );
}

function readPhraseIndexFromJson(
  o: Record<string, unknown>,
  label: string,
  fileLabel: string,
): number {
  const v = o.index;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
    return v;
  }
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    return parseInt(v.trim(), 10);
  }
  throw new Error(
    `${label}: invalid or missing "index" — must be a non-negative integer (${fileLabel})`,
  );
}

async function loadTranscriptFile(inputPath: string): Promise<Phrase[]> {
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

async function loadPhrases(source: TranscriptCliSource): Promise<Phrase[]> {
  if (source.source === 'file') {
    return loadTranscriptFile(source.path);
  }
  return loadTranscriptFromSupabase(source.lessonId);
}

/**
 * Uses the same `{prefix}/{lesson}` layout as `tts:batch`.
 * Defaults to `lesson{id}` under the prefix when the transcript comes from `--transcript-lesson`
 * (or TRANSCRIPT_LESSON_ID), matching `s3LessonFolderForTranscriptLessonId` and typical batch usage.
 * `--lesson` / S3_LESSON overrides that default when set.
 */
function resolveMigrateS3PathConfig(
  cliLesson: string | undefined,
  transcriptSource: TranscriptCliSource,
): S3PathConfig {
  const prefix = normalizeAudioContentPrefix(process.env.AUDIO_CONTENT_PREFIX);
  const envLessonRaw = process.env.S3_LESSON?.trim();

  let raw: string | undefined;
  const cliTrim = cliLesson?.trim();
  if (cliTrim !== undefined && cliTrim !== '') {
    raw = cliTrim;
  } else if (envLessonRaw !== undefined && envLessonRaw !== '') {
    raw = envLessonRaw;
  } else if (transcriptSource.source === 'supabase') {
    raw = s3LessonFolderForTranscriptLessonId(transcriptSource.lessonId);
  }

  const lessonSeg = normalizeLessonSegment(raw);
  return { prefix, lesson: lessonSeg };
}

function parseArgs(argv: string[]): {
  outDir: string;
  dryRun: boolean;
  localOnly: boolean;
  force: boolean;
  noAudioPos: boolean;
  lesson: string | undefined;
  bucket: string | undefined;
  transcriptSource: TranscriptCliSource;
} {
  const args = argv.slice(2);
  let outDir = DEFAULT_OUT;
  let dryRun = false;
  let localOnly = false;
  let force = false;
  let noAudioPos = false;
  let lesson: string | undefined;
  let bucket: string | undefined = process.env.S3_BUCKET_NAME;

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
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--local-only') {
      localOnly = true;
    } else if (a === '--force') {
      force = true;
    } else if (a === '--no-audio-pos') {
      noAudioPos = true;
    } else if (a === '--help' || a === '-h') {
      console.log(`
Migrate legacy Spanish answer-slow (0.9×) → answer-medium + new answer-slow (0.7×)

Copies existing answer-slow MP3 bytes to answer-medium, synthesizes new answer-slow at 0.7×,
updates manifest.json and .cache/hashes.json, optionally uploads to S3 (same as tts:batch).

Usage:
  npm run tts:migrate-spanish-answer-speeds -- --input path/to/lesson.json --out ./output

Options:
  --input, -i           Transcript JSON (or TRANSCRIPT_INPUT)
  --transcript-lesson   Supabase lesson id (or TRANSCRIPT_LESSON_ID)
  --out, -o             Batch output directory with manifest + audio/ (default: ./output)
  --lesson              Overrides S3 folder segment after the prefix (and S3_LESSON env).
                         When omitted, same as Supabase/transcript-lesson convention: defaults to lesson{id}.
  --bucket, -b          S3 bucket (default: S3_BUCKET_NAME)
  --dry-run             Log actions only; do not write files or call Deepgram
  --local-only          Update disk only; skip S3 upload
  --force               Re-run even if manifest already shows migrated clips
  --no-audio-pos        Match batch: skip ffmpeg post-process on new slow clip
  --help, -h            This message

Requires DEEPGRAM_API_KEY unless --dry-run. For S3 upload: AWS_* and bucket (unless --local-only).
`);
      process.exit(0);
    }
  }

  const transcriptSource = resolveTranscriptSource(args);
  return { outDir, dryRun, localOnly, force, noAudioPos, lesson, bucket, transcriptSource };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (!opts.dryRun) {
    requireEnv('DEEPGRAM_API_KEY');
  }
  if (!opts.localOnly && !opts.dryRun) {
    requireEnv('AWS_ACCESS_KEY_ID');
    requireEnv('AWS_SECRET_ACCESS_KEY');
    if (!opts.bucket?.trim()) {
      throw new Error('S3 bucket required: set S3_BUCKET_NAME or pass --bucket (or use --local-only)');
    }
  }

  const phrases = await loadPhrases(opts.transcriptSource);
  const phraseByName = new Map(phrases.map((p) => [p.name, p]));

  const { entries: manifestEntries } = await readManifest(opts.outDir);
  const byId = new Map(manifestEntries.map((e) => [e.id, e]));
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim() ?? '';
  const region = process.env.AWS_REGION?.trim() || 'us-east-1';
  const s3Path = resolveMigrateS3PathConfig(opts.lesson, opts.transcriptSource);
  const voiceEs = getVoiceForLanguage('es');

  if (!opts.dryRun) {
    const seg = s3Path.lesson != null ? `${s3Path.prefix}/${s3Path.lesson}` : s3Path.prefix;
    console.log(`S3 target prefix: ${seg}/`);
  }

  const slowEntries = manifestEntries.filter((e) => e.id.endsWith(SLOW_SUFFIX));
  if (slowEntries.length === 0) {
    console.log('No manifest entries ending with -answer-slow; nothing to do.');
    return;
  }

  await ensureDir(opts.outDir);
  const cache = await readHashCache(opts.outDir);
  const nextEntries: ManifestEntry[] = [...manifestEntries];

  for (const slowEntry of slowEntries) {
    const phraseSlug = slowEntry.id.slice(0, -SLOW_SUFFIX.length);
    const mediumId = `${phraseSlug}${MEDIUM_SUFFIX}`;
    const phrase = phraseByName.get(phraseSlug);
    const text =
      phrase?.Spanish.answer?.trim() ||
      slowEntry.text?.trim() ||
      '';
    if (!text) {
      throw new Error(
        `Cannot resolve Spanish answer text for phrase "${phraseSlug}" (manifest id ${slowEntry.id}).`,
      );
    }

    const slowIs07 = slowEntry.speakingRate === 0.7;
    const hasMedium = byId.has(mediumId);

    if (slowIs07 && !hasMedium) {
      throw new Error(
        `Manifest has 0.7× ${slowEntry.id} but no ${mediumId}; restore files or re-run full tts:batch.`,
      );
    }

    if (slowIs07 && hasMedium && !opts.force) {
      console.log(`Skip ${phraseSlug}: already migrated (use --force to re-synthesize).`);
      continue;
    }

    const needsMedium = !hasMedium || opts.force;
    const needsSlowSynth = !slowIs07 || opts.force;

    console.log(`Migrating ${phraseSlug} …`);

    if (!opts.dryRun) {
      const slowAbs = path.join(opts.outDir, slowEntry.localFile);
      const mediumRel = audioRelativePath(mediumId);
      const mediumAbs = path.join(opts.outDir, mediumRel);

      if (needsMedium) {
        if (!slowIs07) {
          await fs.copyFile(slowAbs, mediumAbs);
          console.log(`  Copied legacy slow → ${mediumRel} (0.9× bytes)`);
        } else {
          const mediumJobSynth: TtsJob = {
            id: mediumId,
            index: slowEntry.index,
            phraseName: phraseSlug,
            language: 'es',
            text,
            voice: voiceEs,
            speakingRate: 0.9,
          };
          const mBuf = await withRetry(() => synthesizeToBuffer(text, 'es', apiKey, 0.9));
          await writeAudioFile(opts.outDir, mediumJobSynth, mBuf, opts.noAudioPos);
          console.log(`  Synthesized ${mediumRel} (0.9×)`);
        }
        const mediumHash = computeJobHash(text, voiceEs, opts.noAudioPos, 0.9);
        const mediumJob: TtsJob = {
          id: mediumId,
          index: slowEntry.index,
          phraseName: phraseSlug,
          language: 'es',
          text,
          voice: voiceEs,
          speakingRate: 0.9,
        };
        const mediumEntry = buildManifestEntry(
          mediumJob,
          mediumRel,
          mediumHash,
          new Date().toISOString(),
          !opts.localOnly,
          opts.localOnly ? undefined : s3Path,
        );
        const existingIdx = nextEntries.findIndex((e) => e.id === mediumId);
        if (existingIdx >= 0) {
          nextEntries[existingIdx] = mediumEntry;
        } else {
          nextEntries.push(mediumEntry);
        }
        cache[mediumId] = mediumHash;
      }

      if (needsSlowSynth) {
        const slowJob: TtsJob = {
          id: slowEntry.id,
          index: slowEntry.index,
          phraseName: phraseSlug,
          language: 'es',
          text,
          voice: voiceEs,
          speakingRate: 0.7,
        };
        const buf = await withRetry(() => synthesizeToBuffer(text, 'es', apiKey, 0.7));
        const slowRel = await writeAudioFile(opts.outDir, slowJob, buf, opts.noAudioPos);
        const slowHash = computeJobHash(text, voiceEs, opts.noAudioPos, 0.7);
        const newSlowEntry = buildManifestEntry(
          slowJob,
          slowRel,
          slowHash,
          new Date().toISOString(),
          !opts.localOnly,
          opts.localOnly ? undefined : s3Path,
        );
        const slowIdx = nextEntries.findIndex((e) => e.id === slowEntry.id);
        if (slowIdx >= 0) {
          nextEntries[slowIdx] = newSlowEntry;
        }
        cache[slowEntry.id] = slowHash;
        console.log(`  Wrote ${slowRel} (0.7×)`);
      }
    } else {
      console.log(`  [dry-run] would update ${mediumId} and/or ${slowEntry.id}`);
    }
  }

  if (opts.dryRun) {
    console.log('Dry run complete; no files written.');
    return;
  }

  nextEntries.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return a.id.localeCompare(b.id);
  });

  await writeHashCache(opts.outDir, cache);
  await writeManifest(opts.outDir, nextEntries);

  const withKeys = opts.localOnly
    ? nextEntries
    : ensureS3Keys(nextEntries, s3Path);

  console.log(`Updated manifest: ${path.join(opts.outDir, 'manifest.json')}`);

  if (!opts.localOnly && opts.bucket?.trim()) {
    const bucketName = opts.bucket.trim();
    const manifestKey = s3ManifestObjectKey(s3Path);
    console.log(`Uploading to s3://${bucketName}/${manifestKey} …`);
    await uploadToS3({
      bucket: bucketName,
      region,
      outDir: opts.outDir,
      entries: withKeys,
      manifestS3Key: manifestKey,
    });
    console.log('Upload complete.');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
