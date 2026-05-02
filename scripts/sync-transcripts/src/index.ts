#!/usr/bin/env node
/**
 * Upserts lesson JSON into Supabase: `lesson_transcripts` + `lesson_catalog`.
 *
 * On-disk shape is always `{ meta, phrases }` (see `packages/logic` `lessonFileSchema`).
 *
 * Source directory: `--source-dir` → `PUSH_TRANSCRIPTS_SOURCE_DIR` → `input/lessons`.
 *
 * Environment:
 * - **NEXT_PUBLIC_SUPABASE_URL**
 * - **SUPABASE_SERVICE_ROLE_KEY**
 * - **PUSH_TRANSCRIPTS_SOURCE_DIR** (optional bulk scan root)
 * - **PUSH_COURSE_LEVEL_SLUG** (optional default when `meta.courseLevelSlug` is omitted)
 *
 * ```bash
 * npm run push:transcripts
 * npm run push:transcripts -- --file input/lessons/1.json
 * ```
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_COURSE_LEVEL_SLUG,
  isTranscriptLessonIdSyntaxValid,
  parseLessonFileJson,
} from '@ai-spanish/logic';

import { loadScriptsEnv } from '../../load-scripts-env.js';
import {
  fetchCourseLevelIdBySlug,
  upsertLessonCatalogRow,
  upsertLessonPhrasesJson,
} from '../../lib/supabase-lesson-transcripts.js';

loadScriptsEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const DEFAULT_PUSH_TRANSCRIPTS_DIR = path.join(REPO_ROOT, 'input', 'lessons');

interface ParsedPushArgs {
  help: boolean;
  sourceDir?: string;
  file?: string;
  lessonId?: string;
  courseLevel?: string;
  catalogTitle?: string;
  catalogDescription?: string;
  sortOrder?: number;
}

function printHelp(): void {
  console.log(`sync-transcripts (push) — upsert lesson_transcripts + lesson_catalog

Usage:
  npm run push:transcripts [--] [--source-dir <dir>] [--file <path> | -f <path>]
    [--lesson-id <id>] [--course-level <slug>] [--catalog-title <s>]
    [--catalog-description <s>] [--sort-order <n>]
  npm run push:transcripts -- --help

  Lesson files are JSON objects: { "meta": { ... }, "phrases": [ ... ] }.
  meta.lessonId must match the filename (e.g. 1.json → "1").
  meta.courseLevelSlug is optional if PUSH_COURSE_LEVEL_SLUG or --course-level is set.

Source directory (bulk only), in order:
  1. --source-dir <path>
  2. PUSH_TRANSCRIPTS_SOURCE_DIR in .env.scripts or environment
  3. <repo>/input/lessons

Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
`);
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
    if (a === '--lesson-id' || a === '-l') {
      const v = rest[i + 1];
      if (!v || v.startsWith('-')) {
        throw new Error('[sync-transcripts] --lesson-id requires an id');
      }
      out.lessonId = v;
      i++;
      continue;
    }
    if (a.startsWith('--lesson-id=')) {
      out.lessonId = a.slice('--lesson-id='.length);
      continue;
    }
    if (a === '--course-level') {
      const v = rest[i + 1];
      if (!v || v.startsWith('-')) {
        throw new Error('[sync-transcripts] --course-level requires a slug');
      }
      out.courseLevel = v;
      i++;
      continue;
    }
    if (a.startsWith('--course-level=')) {
      out.courseLevel = a.slice('--course-level='.length);
      continue;
    }
    if (a === '--catalog-title') {
      const v = rest[i + 1];
      if (!v || v.startsWith('-')) {
        throw new Error('[sync-transcripts] --catalog-title requires a value');
      }
      out.catalogTitle = v;
      i++;
      continue;
    }
    if (a.startsWith('--catalog-title=')) {
      out.catalogTitle = a.slice('--catalog-title='.length);
      continue;
    }
    if (a === '--catalog-description') {
      const v = rest[i + 1];
      if (!v || v.startsWith('-')) {
        throw new Error('[sync-transcripts] --catalog-description requires a value');
      }
      out.catalogDescription = v;
      i++;
      continue;
    }
    if (a.startsWith('--catalog-description=')) {
      out.catalogDescription = a.slice('--catalog-description='.length);
      continue;
    }
    if (a === '--sort-order') {
      const v = rest[i + 1];
      if (!v || v.startsWith('-')) {
        throw new Error('[sync-transcripts] --sort-order requires an integer');
      }
      const n = Number.parseInt(v, 10);
      if (!Number.isInteger(n)) {
        throw new Error('[sync-transcripts] --sort-order must be an integer');
      }
      out.sortOrder = n;
      i++;
      continue;
    }
    if (a.startsWith('--sort-order=')) {
      const n = Number.parseInt(a.slice('--sort-order='.length), 10);
      if (!Number.isInteger(n)) {
        throw new Error('[sync-transcripts] --sort-order must be an integer');
      }
      out.sortOrder = n;
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

async function pushLesson(params: {
  lessonIdFromFilename: string;
  filePath: string;
  cli: ParsedPushArgs;
}): Promise<void> {
  const raw = await fs.readFile(params.filePath, 'utf8');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${params.filePath}`);
  }

  const lessonFile = parseLessonFileJson(parsedJson, params.filePath);
  const { meta } = lessonFile;
  const phrases = lessonFile.phrases;

  if (params.cli.lessonId !== undefined && params.cli.lessonId !== meta.lessonId) {
    throw new Error(
      `[sync-transcripts] --lesson-id ${params.cli.lessonId} does not match meta.lessonId ${meta.lessonId} (${params.filePath})`,
    );
  }

  if (meta.lessonId !== params.lessonIdFromFilename) {
    throw new Error(
      `[sync-transcripts] meta.lessonId "${meta.lessonId}" must match filename id "${params.lessonIdFromFilename}" (${params.filePath})`,
    );
  }

  const lessonId = meta.lessonId;

  const title = params.cli.catalogTitle ?? meta.title;
  const description = params.cli.catalogDescription ?? meta.description;
  const sortOrder = params.cli.sortOrder ?? meta.sortOrder;
  const courseLevelSlug = (
    params.cli.courseLevel ??
    meta.courseLevelSlug ??
    process.env.PUSH_COURSE_LEVEL_SLUG?.trim() ??
    DEFAULT_COURSE_LEVEL_SLUG
  ).trim();

  await upsertLessonPhrasesJson(lessonId, phrases);
  console.log(
    `[sync-transcripts] Upserted lesson_transcripts ${lessonId} (${phrases.length} phrases).`,
  );

  const courseLevelId = await fetchCourseLevelIdBySlug(courseLevelSlug);
  if (!courseLevelId) {
    throw new Error(
      `[sync-transcripts] Unknown course_levels.slug "${courseLevelSlug}". Add the row or set meta.courseLevelSlug / PUSH_COURSE_LEVEL_SLUG / --course-level.`,
    );
  }

  await upsertLessonCatalogRow({
    lessonId,
    courseLevelId,
    title,
    description,
    sortOrder,
  });
  console.log(
    `[sync-transcripts] Upserted lesson_catalog ${lessonId} (course level: ${courseLevelSlug}, sort_order: ${sortOrder}).`,
  );
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
    const lessonIdFromFilename = lessonIdFromPushFile(absPath);
    await pushLesson({
      lessonIdFromFilename,
      filePath: absPath,
      cli: parsed,
    });
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
    await pushLesson({ lessonIdFromFilename: lessonId, filePath: absPath, cli: parsed });
  }
}

main().catch((err: unknown) => {
  console.error('[sync-transcripts]', err instanceof Error ? err.message : err);
  process.exit(1);
});
