#!/usr/bin/env node
/**
 * Idempotent migration: annotates a lesson JSON with stable phrase `name`s and
 * per-word `weight`s derived from POS_WEIGHTS.
 *
 * Accepts legacy shapes (`id`/`order`) or current shape (`name`/`index`).
 *
 * Usage:
 *   npm run migrate:lesson1
 * or:
 *   tsx scripts/migrate-lesson-weights/src/index.ts [path/to/lesson.json]
 *
 * Safe to re-run: if a phrase already has `name` it is kept; weights are
 * recomputed from POS on every run (the canonical derivation).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  POS_WEIGHTS,
  transcriptResponseSchema,
  type PartOfSpeech,
} from '@ai-spanish/logic';

type LegacyWord = { word: string; type: string; weight?: number };

type LegacyPhrase = {
  id?: string;
  name?: string;
  order?: number;
  index?: number;
  type?: 'new' | 'combination';
  English: {
    'first-intro'?: string;
    'second-intro': string;
    question: string;
  };
  Spanish: { grammar: string; answer: string; words: LegacyWord[] };
};

const DEFAULT_INPUT = path.resolve(
  process.cwd(),
  'apps/web/data/transcripts/lesson1.json',
);

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

async function main(): Promise<void> {
  const inputPath = path.resolve(process.cwd(), process.argv[2] ?? DEFAULT_INPUT);
  const raw = await fs.readFile(inputPath, 'utf8');
  const parsed = JSON.parse(raw) as LegacyPhrase[];

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected an array in ${inputPath}`);
  }

  const usedNames = new Set<string>();
  const migrated = parsed.map((phrase, loopIndex) => {
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

    const row: Record<string, unknown> = {
      name,
      index,
      English: phrase.English,
      Spanish: {
        grammar: phrase.Spanish.grammar,
        answer: phrase.Spanish.answer,
        words,
      },
    };
    if (phrase.type != null) {
      row.type = phrase.type;
    }
    return row;
  });

  const result = transcriptResponseSchema.safeParse(migrated);
  if (!result.success) {
    console.error('Migration produced invalid output:', result.error.format());
    process.exit(1);
  }

  const serialized = JSON.stringify(migrated, null, 2) + '\n';
  await fs.writeFile(inputPath, serialized, 'utf8');
  console.log(
    `[migrate-lesson-weights] ${migrated.length} phrases updated in ${inputPath}`,
  );
}

main().catch((err) => {
  console.error('[migrate-lesson-weights] failed:', err);
  process.exit(1);
});
