#!/usr/bin/env node
/**
 * Pulls lesson JSON from Supabase into canonical `{ meta, phrases }` files.
 *
 * Default: all rows → `{base}/<lessonId>.json`
 * Optional: single lesson via positional id or `--lesson <id>`.
 *
 * Base directory: `--output-dir <path>` → `PULL_TRANSCRIPTS_OUTPUT_DIR` → `process.cwd()`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_COURSE_LEVEL_SLUG,
  isTranscriptLessonIdSyntaxValid,
  transcriptResponseSchema,
  type LessonFileMeta,
} from '@ai-spanish/logic';

import { loadScriptsEnv } from '../../load-scripts-env.js';
import {
  fetchAllLessonTranscripts,
  fetchLessonCatalogMeta,
  fetchLessonPhrasesJson,
} from '../../lib/supabase-lesson-transcripts.js';

loadScriptsEnv();

function printHelp(): void {
  console.log(`sync-transcripts (pull) — export lesson_transcripts + lesson_catalog from Supabase

Usage:
  npm run pull:transcripts [--] [--output-dir <dir>] [--lesson <id>] [<lessonId>]
  npm run pull:transcripts -- --help

  With no lesson argument: exports every row to <base>/<id>.json
  With lesson id (positional or --lesson): exports one file only.

  Each file is { "meta": { ... }, "phrases": [ ... ] }.
  When no lesson_catalog row exists, meta is filled with defaults (title "Lesson <id>", etc.).

Output base <base>:
  1. --output-dir <path>
  2. PULL_TRANSCRIPTS_OUTPUT_DIR (from .env.scripts or environment)
  3. current working directory

Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
`);
}

interface ParsedArgs {
  help: boolean;
  outputDir?: string;
  lessonId?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const rest = argv.slice(2);
  const out: ParsedArgs = { help: false };
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
    if (a === '--output-dir') {
      const v = rest[i + 1];
      if (!v || v.startsWith('-')) {
        throw new Error('[sync-transcripts] --output-dir requires a path');
      }
      out.outputDir = v;
      i++;
      continue;
    }
    if (a.startsWith('--output-dir=')) {
      out.outputDir = a.slice('--output-dir='.length);
      continue;
    }
    if (a === '--lesson') {
      const v = rest[i + 1];
      if (!v || v.startsWith('-')) {
        throw new Error('[sync-transcripts] --lesson requires an id');
      }
      out.lessonId = v;
      i++;
      continue;
    }
    if (a.startsWith('--lesson=')) {
      out.lessonId = a.slice('--lesson='.length);
      continue;
    }
    if (a === '--') {
      positionals.push(...rest.slice(i + 1));
      break;
    }
    if (a.startsWith('-')) {
      throw new Error(`[sync-transcripts] Unknown flag: ${a}`);
    }
    positionals.push(a);
  }

  if (positionals.length > 1) {
    throw new Error(
      '[sync-transcripts] At most one positional lesson id; use --lesson for clarity.',
    );
  }
  if (positionals.length === 1) {
    if (out.lessonId !== undefined && out.lessonId !== positionals[0]) {
      throw new Error(
        `[sync-transcripts] Conflicting lesson ids: --lesson ${out.lessonId} vs positional ${positionals[0]}`,
      );
    }
    out.lessonId = positionals[0];
  }

  return out;
}

function resolveOutputBase(cliOutputDir: string | undefined): string {
  if (cliOutputDir !== undefined && cliOutputDir.length > 0) {
    return path.resolve(cliOutputDir);
  }
  const fromEnv = process.env.PULL_TRANSCRIPTS_OUTPUT_DIR?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  return process.cwd();
}

function buildDefaultMeta(lessonId: string): LessonFileMeta {
  const n = Number(lessonId);
  const sortOrder = Number.isInteger(n) && n > 0 ? n : 1;
  return {
    lessonId,
    sortOrder,
    title: `Lesson ${lessonId}`,
    description: '',
    courseLevelSlug: DEFAULT_COURSE_LEVEL_SLUG,
  };
}

async function writeLessonFile(
  outputBase: string,
  lessonId: string,
  data: ReturnType<typeof transcriptResponseSchema.parse>,
): Promise<void> {
  const filePath = path.join(outputBase, `${lessonId}.json`);

  const catalogRow = await fetchLessonCatalogMeta(lessonId);
  let meta: LessonFileMeta;
  if (catalogRow) {
    meta = {
      lessonId,
      sortOrder: catalogRow.sort_order,
      title: catalogRow.title,
      description: catalogRow.description,
      courseLevelSlug: catalogRow.course_level_slug,
    };
  } else {
    meta = buildDefaultMeta(lessonId);
  }

  const bodyObj = { meta, phrases: data };
  const body = `${JSON.stringify(bodyObj, null, 2)}\n`;
  await fs.writeFile(filePath, body, 'utf8');
  console.log(
    `[sync-transcripts] Wrote ${filePath} (${data.length} phrases).`,
  );
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
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

  const base = resolveOutputBase(parsed.outputDir);
  await fs.mkdir(base, { recursive: true });

  if (parsed.lessonId !== undefined) {
    const id = parsed.lessonId;
    if (!isTranscriptLessonIdSyntaxValid(id)) {
      throw new Error(
        `[sync-transcripts] Invalid lesson id "${id}" (expected decimal string, no leading zeros).`,
      );
    }
    const raw = await fetchLessonPhrasesJson(id);
    const validated = transcriptResponseSchema.parse(raw);
    await writeLessonFile(base, id, validated);
    return;
  }

  const rows = await fetchAllLessonTranscripts();
  if (rows.length === 0) {
    throw new Error(
      '[sync-transcripts] No rows in lesson_transcripts; nothing to export.',
    );
  }

  const sorted = [...rows].sort((a, b) => {
    const na = Number(a.lesson_id);
    const nb = Number(b.lesson_id);
    const bothNumeric = !Number.isNaN(na) && !Number.isNaN(nb);
    return bothNumeric ? na - nb : a.lesson_id.localeCompare(b.lesson_id);
  });

  for (const row of sorted) {
    const validated = transcriptResponseSchema.parse(row.phrases);
    await writeLessonFile(base, row.lesson_id, validated);
  }

  console.log(`[sync-transcripts] Exported ${sorted.length} lesson(s) to ${base}.`);
}

main().catch((err: unknown) => {
  console.error('[sync-transcripts]', err instanceof Error ? err.message : err);
  process.exit(1);
});
