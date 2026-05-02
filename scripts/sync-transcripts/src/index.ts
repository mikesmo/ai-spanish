#!/usr/bin/env node
/**
 * Upserts transcript phrase decks into Supabase `lesson_transcripts` using the service role.
 *
 * **Bulk:** Scans a directory for `{lessonId}.json` (valid decimal id, no leading zeros).
 * **Single file:** `--file path/to/1.json` (lesson id from basename).
 *
 * Source directory `{source}`: `--source-dir` → `PUSH_TRANSCRIPTS_SOURCE_DIR` →
 * `input` under repo root.
 *
 * Environment:
 * - **NEXT_PUBLIC_SUPABASE_URL**
 * - **SUPABASE_SERVICE_ROLE_KEY**
 * - **PUSH_TRANSCRIPTS_SOURCE_DIR** (optional bulk scan root)
 *
 * Does **not** call the Next.js API. Secrets: repo-root **`.env.scripts`**.
 *
 * ```bash
 * npm run push:transcripts
 * npm run push:transcripts -- --file output/transcripts/1.json
 * ```
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isTranscriptLessonIdSyntaxValid,
  transcriptResponseSchema,
} from '@ai-spanish/logic';

import { loadScriptsEnv } from '../../load-scripts-env.js';

import { upsertLessonPhrasesJson } from './supabase-lesson-transcript.js';

loadScriptsEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const DEFAULT_PUSH_TRANSCRIPTS_DIR = path.join(REPO_ROOT, 'input');

function printHelp(): void {
  console.log(`sync-transcripts (push) — upsert lesson_transcripts from JSON on disk

Usage:
  npm run push:transcripts [--] [--source-dir <dir>] [--file <path> | -f <path>]
  npm run push:transcripts -- --help

  Bulk (default): scan directory for *.json with valid lesson ids (e.g. 1.json).
  Single file: --file / -f pushes one transcript; lesson id is the basename without .json.
  If both --file and --source-dir are set, --file wins (directory is ignored).

Source directory (bulk only), in order:
  1. --source-dir <path>
  2. PUSH_TRANSCRIPTS_SOURCE_DIR in .env.scripts or environment
  3. <repo>/input

Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
`);
}

interface ParsedPushArgs {
  help: boolean;
  sourceDir?: string;
  file?: string;
}

function parseArgs(argv: string[]): ParsedPushArgs {
  const rest = argv.slice(2);
  const out: ParsedPushArgs = { help: false };

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
    if (a === '--source-dir') {
      const v = rest[i + 1];
      if (!v || v.startsWith('-')) {
        throw new Error('[sync-transcripts] --source-dir requires a path');
      }
      out.sourceDir = v;
      i++;
      continue;
    }
    if (a.startsWith('--source-dir=')) {
      out.sourceDir = a.slice('--source-dir='.length);
      continue;
    }
    if (a === '--file' || a === '-f') {
      const v = rest[i + 1];
      if (!v || v.startsWith('-')) {
        throw new Error(`[sync-transcripts] ${a} requires a path`);
      }
      out.file = v;
      i++;
      continue;
    }
    if (a.startsWith('--file=')) {
      out.file = a.slice('--file='.length);
      continue;
    }
    if (a === '--') {
      continue;
    }
    if (a.startsWith('-')) {
      throw new Error(`[sync-transcripts] Unknown flag: ${a}`);
    }
  }

  return out;
}

function resolveSourceDir(cliSourceDir: string | undefined): string {
  if (cliSourceDir !== undefined && cliSourceDir.length > 0) {
    return path.resolve(process.cwd(), cliSourceDir);
  }
  const fromEnv = process.env.PUSH_TRANSCRIPTS_SOURCE_DIR?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  return DEFAULT_PUSH_TRANSCRIPTS_DIR;
}

async function listTranscriptLessonFiles(
  transcriptsDir: string,
): Promise<{ lessonId: string; absPath: string }[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(transcriptsDir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `[sync-transcripts] Cannot read transcripts directory ${transcriptsDir}: ${msg}`,
    );
  }

  const out: { lessonId: string; absPath: string }[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const lessonId = name.slice(0, -'.json'.length);
    if (!isTranscriptLessonIdSyntaxValid(lessonId)) continue;
    out.push({
      lessonId,
      absPath: path.join(transcriptsDir, name),
    });
  }

  out.sort((a, b) => Number(a.lessonId) - Number(b.lessonId));
  return out;
}

async function pushLesson(params: {
  lessonId: string;
  filePath: string;
}): Promise<void> {
  const raw = await fs.readFile(params.filePath, 'utf8');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${params.filePath}`);
  }

  const validated = transcriptResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    console.error(
      `[sync-transcripts] Validation failed for lesson ${params.lessonId}:`,
      validated.error.flatten(),
    );
    throw new Error(`Transcript validation failed for lesson ${params.lessonId}`);
  }

  await upsertLessonPhrasesJson(params.lessonId, validated.data);

  console.log(
    `[sync-transcripts] Upserted lesson ${params.lessonId} (${validated.data.length} phrases).`,
  );
}

function lessonIdFromPushFile(absFilePath: string): string {
  const base = path.basename(absFilePath);
  if (!base.endsWith('.json')) {
    throw new Error(
      '[sync-transcripts] --file must be a path ending in .json (e.g. 1.json).',
    );
  }
  const lessonId = base.slice(0, -'.json'.length);
  if (!isTranscriptLessonIdSyntaxValid(lessonId)) {
    throw new Error(
      `[sync-transcripts] Invalid lesson id from filename "${base}" (expected decimal string, no leading zeros).`,
    );
  }
  return lessonId;
}

async function main(): Promise<void> {
  let parsed: ParsedPushArgs;
  try {
    parsed = parseArgs(process.argv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
    return;
  }

  if (parsed.help) {
    printHelp();
    return;
  }

  if (parsed.file !== undefined && parsed.file.length > 0) {
    const absPath = path.resolve(process.cwd(), parsed.file);
    const lessonId = lessonIdFromPushFile(absPath);
    await pushLesson({ lessonId, filePath: absPath });
    return;
  }

  const sourceDir = resolveSourceDir(parsed.sourceDir);
  const files = await listTranscriptLessonFiles(sourceDir);
  if (files.length === 0) {
    throw new Error(
      `[sync-transcripts] No transcript JSON files found in ${sourceDir}. Add files like 1.json, 3.json.`,
    );
  }

  for (const { lessonId, absPath } of files) {
    await pushLesson({ lessonId, filePath: absPath });
  }
}

main().catch((err: unknown) => {
  console.error('[sync-transcripts]', err instanceof Error ? err.message : err);
  process.exit(1);
});
