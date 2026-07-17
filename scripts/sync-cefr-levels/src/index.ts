#!/usr/bin/env node
/**
 * Upserts CEFR level reference content into Supabase:
 * `cefr_level_words` + `cefr_level_grammar`.
 *
 * On-disk shape (per level directory):
 * - `words.json`: `{ meta: { courseLevelSlug }, words: { <category>: string[] } }`
 * - `grammar.json`: `{ meta: { courseLevelSlug }, grammar: string[] }`
 *
 * Source directory: `--source-dir` → `PUSH_CEFR_LEVELS_SOURCE_DIR` → `input/cefr_levels`.
 * Each immediate subdirectory (e.g. `a1/`, `a2/`) is one CEFR level.
 *
 * Environment:
 * - **NEXT_PUBLIC_SUPABASE_URL**
 * - **SUPABASE_SERVICE_ROLE_KEY**
 * - **PUSH_CEFR_LEVELS_SOURCE_DIR** (optional)
 *
 * ```bash
 * npm run push:cefr-levels
 * npm run push:cefr-levels -- --level a1
 * ```
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CEFR_LEVELS,
  cefrLevelGrammarFileSchema,
  cefrLevelWordsFileSchema,
  normalizeStr,
  type CefrLevel,
} from '@ai-spanish/logic';

import { loadScriptsEnv } from '../../load-scripts-env.js';
import {
  upsertCefrLevelGrammar,
  upsertCefrLevelWords,
  type CefrLevelWordSeedRow,
} from '../../lib/supabase-cefr-levels.js';

loadScriptsEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const DEFAULT_CEFR_LEVELS_DIR = path.join(REPO_ROOT, 'input', 'cefr_levels');

interface ParsedPushArgs {
  help: boolean;
  sourceDir?: string;
  level?: string;
}

function printHelp(): void {
  console.log(`sync-cefr-levels (push) — upsert cefr_level_words + cefr_level_grammar

Usage:
  npm run push:cefr-levels [--] [--source-dir <dir>] [--level <slug>]
  npm run push:cefr-levels -- --help

  Each level directory must contain words.json and grammar.json
  (see input/cefr_levels/a1/ for the expected shape).

Source directory, in order:
  1. --source-dir <path>
  2. PUSH_CEFR_LEVELS_SOURCE_DIR in .env.scripts or environment
  3. <repo>/input/cefr_levels

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
        throw new Error('[sync-cefr-levels] --source-dir requires a path');
      }
      out.sourceDir = v;
      i++;
      continue;
    }
    if (a.startsWith('--source-dir=')) {
      out.sourceDir = a.slice('--source-dir='.length);
      continue;
    }
    if (a === '--level' || a === '-l') {
      const v = rest[i + 1];
      if (!v || v.startsWith('-')) {
        throw new Error('[sync-cefr-levels] --level requires a directory name (e.g. a1)');
      }
      out.level = v;
      i++;
      continue;
    }
    if (a.startsWith('--level=')) {
      out.level = a.slice('--level='.length);
      continue;
    }
    if (a === '--') {
      continue;
    }
    if (a.startsWith('-')) {
      throw new Error(`[sync-cefr-levels] Unknown flag: ${a}`);
    }
  }

  return out;
}

function resolveSourceDir(cliSourceDir: string | undefined): string {
  if (cliSourceDir !== undefined && cliSourceDir.length > 0) {
    return path.resolve(process.cwd(), cliSourceDir);
  }
  const fromEnv = process.env.PUSH_CEFR_LEVELS_SOURCE_DIR?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  return DEFAULT_CEFR_LEVELS_DIR;
}

async function listLevelDirs(
  levelsDir: string,
  onlyDirName: string | undefined,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(levelsDir);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[sync-cefr-levels] Cannot read levels directory ${levelsDir}: ${msg}`);
  }

  const out: string[] = [];
  for (const name of entries) {
    if (onlyDirName && name !== onlyDirName) continue;
    const abs = path.join(levelsDir, name);
    const stat = await fs.stat(abs).catch(() => null);
    if (stat?.isDirectory()) out.push(name);
  }
  out.sort();
  return out;
}

/** `nouns` → `noun`, `interjections` → `interjection`, etc. Informational label only. */
function singularizeCategory(category: string): string {
  return category.endsWith('s') ? category.slice(0, -1) : category;
}

async function readJsonFile(absPath: string): Promise<unknown> {
  const raw = await fs.readFile(absPath, 'utf8');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`[sync-cefr-levels] Invalid JSON in ${absPath}`);
  }
}

function resolveCefrLevel(courseLevelSlug: string, fileLabel: string): CefrLevel {
  const upper = courseLevelSlug.trim().toUpperCase();
  const match = (CEFR_LEVELS as readonly string[]).find((l) => l === upper);
  if (!match) {
    throw new Error(
      `[sync-cefr-levels] ${fileLabel}: meta.courseLevelSlug "${courseLevelSlug}" is not a valid CEFR level (expected one of ${CEFR_LEVELS.join(', ')})`,
    );
  }
  return match as CefrLevel;
}

async function pushLevel(levelDirName: string, levelsDir: string): Promise<void> {
  const dir = path.join(levelsDir, levelDirName);
  const wordsPath = path.join(dir, 'words.json');
  const grammarPath = path.join(dir, 'grammar.json');

  const wordsJson = await readJsonFile(wordsPath);
  const wordsFile = cefrLevelWordsFileSchema.parse(wordsJson);
  const grammarJson = await readJsonFile(grammarPath);
  const grammarFile = cefrLevelGrammarFileSchema.parse(grammarJson);

  const level = resolveCefrLevel(wordsFile.meta.courseLevelSlug, wordsPath);
  const grammarLevel = resolveCefrLevel(grammarFile.meta.courseLevelSlug, grammarPath);
  if (level !== grammarLevel) {
    throw new Error(
      `[sync-cefr-levels] ${levelDirName}: words.json level "${level}" does not match grammar.json level "${grammarLevel}"`,
    );
  }

  // Dedupe by (level, normalizedWord); first category encountered wins `pos`
  // (a handful of words appear under more than one category pre-normalization,
  // e.g. "Frío" as both noun and adjective).
  const wordRowsByNormalized = new Map<string, CefrLevelWordSeedRow>();
  for (const [category, words] of Object.entries(wordsFile.words)) {
    const pos = singularizeCategory(category);
    for (const word of words) {
      const normalized = normalizeStr(word);
      if (!normalized) continue;
      if (!wordRowsByNormalized.has(normalized)) {
        wordRowsByNormalized.set(normalized, { level, word: normalized, pos });
      }
    }
  }
  const wordRows = Array.from(wordRowsByNormalized.values());

  const grammarItems = Array.from(
    new Set(grammarFile.grammar.map((g) => g.trim()).filter((g) => g.length > 0)),
  );

  await upsertCefrLevelWords(wordRows);
  console.log(
    `[sync-cefr-levels] Upserted cefr_level_words for ${level} (${wordRows.length} words).`,
  );

  await upsertCefrLevelGrammar(level, grammarItems);
  console.log(
    `[sync-cefr-levels] Upserted cefr_level_grammar for ${level} (${grammarItems.length} items).`,
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

  const levelsDir = resolveSourceDir(parsed.sourceDir);
  const levelDirs = await listLevelDirs(levelsDir, parsed.level);
  if (levelDirs.length === 0) {
    throw new Error(
      `[sync-cefr-levels] No level directories found in ${levelsDir}. Add directories like a1/, a2/ with words.json + grammar.json.`,
    );
  }

  for (const levelDirName of levelDirs) {
    await pushLevel(levelDirName, levelsDir);
  }
}

main().catch((err: unknown) => {
  console.error('[sync-cefr-levels]', err instanceof Error ? err.message : err);
  process.exit(1);
});
