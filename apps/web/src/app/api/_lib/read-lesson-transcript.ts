import fs from 'fs';
import path from 'path';

import type { Phrase } from '@ai-spanish/logic';

const TRANSCRIPTS_DIR = path.join(process.cwd(), 'data', 'transcripts');

const VALID_LESSON_IDS = new Set(['1', '2']);
const DEFAULT_LESSON = '1';

/** Resolves validated lesson id (matches `/api/transcript` behavior). */
export function resolveLessonIdForFiles(raw: string | null | undefined): string {
  const s = raw?.trim() ?? '';
  if (s === '' || !VALID_LESSON_IDS.has(s)) {
    return DEFAULT_LESSON;
  }
  return s;
}

/** Reads parsed lesson transcript JSON from `data/transcripts/lesson{n}.json`. */
export function readTranscriptFile(lessonIdRaw: string | null | undefined): Phrase[] {
  const canonical = resolveLessonIdForFiles(lessonIdRaw ?? '');
  const jsonPath = path.join(TRANSCRIPTS_DIR, `lesson${canonical}.json`);
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const phrases = JSON.parse(raw) as unknown;
  if (!Array.isArray(phrases)) {
    throw new Error('Transcript must be a JSON array of phrases');
  }
  return phrases as Phrase[];
}
