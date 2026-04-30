#!/usr/bin/env node
/**
 * Upserts transcript phrase decks into Supabase `lesson_transcripts` using the service role.
 *
 * Expects JSON files at `apps/web/data/transcripts/{lessonId}.json` where `lessonId` is a
 * positive decimal string without leading zeros (matches DB + `@ai-spanish/logic`).
 *
 * Environment:
 * - **NEXT_PUBLIC_SUPABASE_URL**
 * - **SUPABASE_SERVICE_ROLE_KEY**
 *
 * Same credentials pattern as [`migrate-lesson-weights`](../migrate-lesson-weights/src/supabase-lesson-transcript.ts) and
 * [`tts-batch`](../tts-batch/). Does **not** call the Next.js API.
 *
 * Configure secrets in repo-root **`.env.scripts`** (copy from **`.env.scripts.example`**).
 *
 * ```bash
 * npm run push:transcripts
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

const TRANSCRIPTS_DIR = path.join(REPO_ROOT, 'apps/web/data/transcripts');

async function listTranscriptLessonFiles(): Promise<{ lessonId: string; absPath: string }[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(TRANSCRIPTS_DIR);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Cannot read transcripts directory ${TRANSCRIPTS_DIR}: ${msg}. Run from repo root.`,
    );
  }

  const out: { lessonId: string; absPath: string }[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const lessonId = name.slice(0, -'.json'.length);
    if (!isTranscriptLessonIdSyntaxValid(lessonId)) continue;
    out.push({
      lessonId,
      absPath: path.join(TRANSCRIPTS_DIR, name),
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
      `[push-transcripts] Validation failed for lesson ${params.lessonId}:`,
      validated.error.flatten(),
    );
    throw new Error(`Transcript validation failed for lesson ${params.lessonId}`);
  }

  await upsertLessonPhrasesJson(params.lessonId, validated.data);

  console.log(
    `[push-transcripts] Upserted lesson ${params.lessonId} (${validated.data.length} phrases).`,
  );
}

async function main(): Promise<void> {
  const files = await listTranscriptLessonFiles();
  if (files.length === 0) {
    throw new Error(
      `No transcript JSON files found in ${TRANSCRIPTS_DIR}. Add files like 1.json, 3.json.`,
    );
  }

  for (const { lessonId, absPath } of files) {
    await pushLesson({ lessonId, filePath: absPath });
  }
}

main().catch((err: unknown) => {
  console.error('[push-transcripts]', err instanceof Error ? err.message : err);
  process.exit(1);
});
