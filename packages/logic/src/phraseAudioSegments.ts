import type { Language, Phrase } from './types';

/** Segments backed by TTS batch + Sheet Record (same ids as `PhraseAudioClipSpec.id` suffix). */
export const PHRASE_SYNTH_SEGMENTS = ['first-intro', 'second-intro', 'answer'] as const;

export type PhraseSynthSegment = (typeof PHRASE_SYNTH_SEGMENTS)[number];

export function isPhraseSynthSegment(value: string): value is PhraseSynthSegment {
  return (PHRASE_SYNTH_SEGMENTS as readonly string[]).includes(value);
}

/**
 * Language used for Deepgram TTS for the given clip segment (matches `buildPhraseAudioClipSpecs`).
 */
export function languageForPhraseAudioSegment(segment: PhraseSynthSegment): Language {
  return segment === 'answer' ? 'es' : 'en';
}

/** Stable clip id: `{phraseName}-{segment}` (e.g. `perdona-first-intro`). */
export function phraseClipJobId(phraseName: string, segment: PhraseSynthSegment): string {
  return `${phraseName}-${segment}`;
}

/**
 * Parses clip id suffix into a synth segment (`second-intro` before `first-intro`).
 */
export function phraseSynthSegmentFromClipId(id: string): PhraseSynthSegment | null {
  if (id.endsWith('-second-intro')) return 'second-intro';
  if (id.endsWith('-first-intro')) return 'first-intro';
  if (id.endsWith('-answer')) return 'answer';
  return null;
}

/**
 * Returns duplicate phrase names (lower-trimmed) if any; empty array when all unique.
 */
export function findDuplicatePhraseNames(phrases: readonly { name: string }[]): string[] {
  const seen = new Map<string, number>();
  const dup = new Set<string>();
  for (const p of phrases) {
    const key = String(p.name ?? '')
      .trim()
      .toLowerCase();
    if (key === '') continue;
    const prev = seen.get(key);
    if (prev !== undefined) {
      dup.add(key);
    } else {
      seen.set(key, 1);
    }
  }
  return [...dup];
}

/**
 * Deep-clones `phrases`, updates one segment from sheet/TTS for `phraseIndex`, returns new array.
 */
export function mergePhraseSegmentText(
  phrases: readonly Phrase[],
  phraseIndex: number,
  segment: PhraseSynthSegment,
  text: string
): Phrase[] {
  const next = phrases.map((p) =>
    structuredClone(p),
  ) as Phrase[];
  const idx = next.findIndex((p) => p.index === phraseIndex);
  if (idx === -1) {
    throw new Error(`mergePhraseSegmentText: phrase index ${phraseIndex} not found`);
  }
  const row = next[idx];
  if (!row) {
    throw new Error(`mergePhraseSegmentText: phrase index ${phraseIndex} not found`);
  }
  if (segment === 'first-intro' || segment === 'second-intro') {
    row.English = { ...row.English, [segment]: text };
  } else {
    row.Spanish = { ...row.Spanish, answer: text };
  }
  return next;
}
