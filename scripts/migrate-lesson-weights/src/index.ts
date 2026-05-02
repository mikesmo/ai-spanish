#!/usr/bin/env node
/**
 * Idempotent migration: annotates a lesson JSON with stable phrase `name`s and
 * per-word `weight`s derived from POS_WEIGHTS.
 *
 * Accepts legacy shapes (`id`/`order`) or current shape (`name`/`index`).
 *
 * Usage:
 *   npm run migrate:lesson1 -- path/to/lesson.json
 * or (Supabase `lesson_transcripts` row):
 *   TRANSCRIPT_LESSON_ID=1 npm run migrate:lesson1
 *
 * Supabase URL and service role may be set in repo-root `.env.scripts` (see `.env.scripts.example`).
 *
 * Safe to re-run: if a phrase already has `name` it is kept; weights are
 * recomputed from POS on every run (the canonical derivation).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadScriptsEnv } from '../../load-scripts-env.js';

import {
  isTranscriptLessonIdSyntaxValid,
  POS_WEIGHTS,
  type PartOfSpeech,
} from '@ai-spanish/logic';
import { transcriptResponseSchema } from '../../../packages/logic/src/schemas/phrase.js';

import {
  fetchLessonPhrasesJson,
  upsertLessonPhrasesJson,
} from './supabase-lesson-transcript.js';

loadScriptsEnv();

type LegacyWord = { word: string; type: string; weight?: number };

type LegacyPhrase = {
  id?: string;
  name?: string;
  order?: number;
  index?: number;
  category?: string;
  type?: 'new' | 'composite' | 'combination';
  English: {
    'first-intro'?: string;
    'second-intro': string;
    question: string;
  };
  Spanish: {
    grammar: string;
    answer: string;
    newGrammar?: string;
    newWords?: string;
    words: LegacyWord[];
  };
};

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function assertKnownPos(type: string, context: string): PartOfSpeech {
  if (!(type in POS_WEIGHTS)) {
    throw new Error(
      `Unknown part-of-speech "${type}" in ${context}. ` +
        `Known: ${Object.keys(POS_WEIGHTS).join(', ')}`,
    );
  }
  return type as PartOfSpeech;
}

function migratePhraseRows(parsed: LegacyPhrase[]): Record<string, unknown>[] {
  const usedNames = new Set<string>();
  return parsed.map((phrase, loopIndex) => {
    const pos = phrase.Spanish?.answer ?? `phrase-${loopIndex}`;
    let name =
      phrase.name ??
      phrase.id ??
      (slugify(pos) || `phrase-${loopIndex}`);
    let suffix = 2;
    const base = name;
    while (usedNames.has(name)) {
      name = `${base}-${suffix++}`;
    }
    usedNames.add(name);

    const index = phrase.index ?? phrase.order ?? loopIndex;
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(
        `phrase[${loopIndex}] invalid index/order: ${String(index)}`,
      );
    }

    const words = phrase.Spanish.words.map((w, wi) => {
      const posTag = assertKnownPos(
        w.type,
        `phrase[${loopIndex}].Spanish.words[${wi}] ("${w.word}")`,
      );
      return {
        word: w.word,
        type: posTag,
        weight: POS_WEIGHTS[posTag],
      };
    });

    const spanish: Record<string, unknown> = {
      grammar: phrase.Spanish.grammar,
      answer: phrase.Spanish.answer,
      words,
    };
    if (phrase.Spanish.newGrammar !== undefined) {
      spanish.newGrammar = phrase.Spanish.newGrammar;
    }
    if (phrase.Spanish.newWords !== undefined) {
      spanish.newWords = phrase.Spanish.newWords;
    }

    const row: Record<string, unknown> = {
      name,
      index,
      English: phrase.English,
      Spanish: spanish,
    };
    if (phrase.category !== undefined) {
      row.category = phrase.category;
    }
    if (phrase.type != null) {
      row.type =
        phrase.type === 'combination' ? 'composite' : phrase.type;
    }
    return row;
  });
}

async function main(): Promise<void> {
  const cliPath = process.argv[2]?.trim();
  const lessonFromEnv = process.env.TRANSCRIPT_LESSON_ID?.trim();

  let parsed: LegacyPhrase[];
  let sink: 'file' | 'supabase';
  let filePath = '';
  let lessonId = '';

  /** Present when input file is `{ meta, phrases }`; written back unchanged on file sink */
  let fileMeta: unknown = undefined;

  if (cliPath) {
    filePath = path.resolve(process.cwd(), cliPath);
    const raw = await fs.readFile(filePath, 'utf8');
    let rawData: unknown;
    try {
      rawData = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`Invalid JSON in ${filePath}`);
    }
    if (Array.isArray(rawData)) {
      parsed = rawData as LegacyPhrase[];
    } else if (
      rawData &&
      typeof rawData === 'object' &&
      !Array.isArray(rawData) &&
      'phrases' in rawData
    ) {
      const o = rawData as { phrases: unknown; meta?: unknown };
      if (!Array.isArray(o.phrases)) {
        throw new Error(`Expected file.phrases to be an array (${filePath})`);
      }
      parsed = o.phrases as LegacyPhrase[];
      if (o.meta !== undefined) {
        fileMeta = o.meta;
      }
    } else {
      throw new Error(
        `Expected transcript JSON array or { meta?, phrases: [...] } (${filePath})`,
      );
    }
    sink = 'file';
  } else if (lessonFromEnv && isTranscriptLessonIdSyntaxValid(lessonFromEnv)) {
    lessonId = lessonFromEnv;
    const rawJson = await fetchLessonPhrasesJson(lessonFromEnv);
    parsed = rawJson as LegacyPhrase[];
    sink = 'supabase';
  } else {
    throw new Error(
      'Provide path/to/lesson.json as the first argument, or set TRANSCRIPT_LESSON_ID to a valid transcript lesson id (positive integer string, no leading zeros) with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  const migrated = migratePhraseRows(parsed);

  const result = transcriptResponseSchema.safeParse(migrated);
  if (!result.success) {
    console.error('Migration produced invalid output:', result.error.format());
    process.exit(1);
  }

  if (sink === 'file') {
    const payload =
      fileMeta !== undefined ? { meta: fileMeta, phrases: migrated } : migrated;
    const serialized = JSON.stringify(payload, null, 2) + '\n';
    await fs.writeFile(filePath, serialized, 'utf8');
    console.log(
      `[migrate-lesson-weights] ${migrated.length} phrases updated in ${filePath}`,
    );
    return;
  }

  await upsertLessonPhrasesJson(lessonId, migrated);
  console.log(
    `[migrate-lesson-weights] ${migrated.length} phrases updated in Supabase lesson_transcripts (${lessonId})`,
  );
}

main().catch((err) => {
  console.error('[migrate-lesson-weights] failed:', err);
  process.exit(1);
});
