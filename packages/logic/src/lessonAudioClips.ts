import type { Phrase } from './types';

/**
 * Every S3 clip segment the learner app can request (`{phraseName}-{segment}.mp3`).
 * `question` is requested when an intro ends with `:` even though tts-batch
 * does not synthesize it; the batch presign response reports it as missing.
 */
export const AUDIO_CLIP_SEGMENTS = [
  'first-intro',
  'second-intro',
  'follow-up',
  'explain',
  'question',
  'answer',
  'answer-medium',
  'answer-slow',
] as const;

export type AudioClipSegment = (typeof AUDIO_CLIP_SEGMENTS)[number];

export function isAudioClipSegment(value: string): value is AudioClipSegment {
  return (AUDIO_CLIP_SEGMENTS as readonly string[]).includes(value);
}

/** Phrase slug format accepted by the audio presign APIs. */
export const AUDIO_PHRASE_NAME_PATTERN = /^[a-z0-9-]+$/;

/** Upper bound on clips per `POST /api/audio/batch` request. */
export const LESSON_AUDIO_BATCH_MAX_CLIPS = 1000;

/** Same-origin path for the lesson-wide presign endpoint. */
export const AUDIO_BATCH_PRESIGN_PATH = '/api/audio/batch';

export interface LessonAudioClip {
  phraseName: string;
  segment: AudioClipSegment;
}

/** Stable clip id / S3 file stem: `{phraseName}-{segment}`. */
export function lessonAudioClipId(phraseName: string, segment: AudioClipSegment): string {
  return `${phraseName}-${segment}`;
}

function hasText(text: string | undefined): boolean {
  return (text ?? '').trim() !== '';
}

function clipsForPhrase(phrase: Phrase): LessonAudioClip[] {
  const { name, English, Spanish } = phrase;
  const clips: LessonAudioClip[] = [];
  const push = (segment: AudioClipSegment): void => {
    clips.push({ phraseName: name, segment });
  };
  if (hasText(English['first-intro'])) push('first-intro');
  if (hasText(English['second-intro'])) push('second-intro');
  const introEndsWithColon = [English['first-intro'], English['second-intro']].some((t) =>
    (t ?? '').trimEnd().endsWith(':'),
  );
  if (introEndsWithColon) push('question');
  if (hasText(Spanish.answer)) push('answer-medium');
  if (hasText(English['follow-up'])) push('follow-up');
  if (hasText(Spanish.answer)) push('answer');
  if (hasText(English.explain)) push('explain');
  return clips;
}

/**
 * Every clip a lesson session may play, ordered for background preloading:
 * phrases start at `startPhraseName` (the card shown first) and wrap around the
 * deck; within a phrase, clips follow playback order. `answer-slow` clips (only
 * used by the slow-replay control) go last. Phrase names are deduplicated.
 */
export function buildLessonAudioClipList(
  deck: readonly Phrase[],
  startPhraseName?: string,
): LessonAudioClip[] {
  const seen = new Set<string>();
  const unique = deck.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
  const startIdx = Math.max(
    0,
    unique.findIndex((p) => p.name === startPhraseName),
  );
  const ordered = [...unique.slice(startIdx), ...unique.slice(0, startIdx)];
  const clips = ordered.flatMap(clipsForPhrase);
  const slow = ordered
    .filter((p) => hasText(p.Spanish.answer))
    .map((p): LessonAudioClip => ({ phraseName: p.name, segment: 'answer-slow' }));
  return [...clips, ...slow];
}
