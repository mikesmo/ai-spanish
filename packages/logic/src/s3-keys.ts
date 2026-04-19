/** Default S3 prefix when AUDIO_CONTENT_PREFIX is unset or empty. */
export const DEFAULT_AUDIO_CONTENT_PREFIX = 'audio-content';

/** S3 key layout used by tts-batch uploads and the web presign API. */
export interface S3PathConfig {
  prefix: string;
  /** Single path segment (e.g. lesson1); omitted when unset. */
  lesson?: string;
}

function assertSafePathSegment(label: string, value: string): void {
  if (value.includes('..')) {
    throw new Error(`${label} must not contain ".."`);
  }
}

/**
 * Normalizes env AUDIO_CONTENT_PREFIX (e.g. /audio-content/ → audio-content).
 * Defaults to DEFAULT_AUDIO_CONTENT_PREFIX when unset or blank.
 */
export function normalizeAudioContentPrefix(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_AUDIO_CONTENT_PREFIX;
  }
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  if (trimmed === '') {
    return DEFAULT_AUDIO_CONTENT_PREFIX;
  }
  assertSafePathSegment('AUDIO_CONTENT_PREFIX', trimmed);
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length !== 1) {
    throw new Error(
      'AUDIO_CONTENT_PREFIX must be a single path segment (e.g. audio-content), not a nested path'
    );
  }
  return segments[0]!;
}

/**
 * Optional lesson segment: one folder under the prefix. Empty → undefined.
 */
export function normalizeLessonSegment(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  if (trimmed === '') {
    return undefined;
  }
  assertSafePathSegment('lesson', trimmed);
  if (trimmed.includes('/')) {
    throw new Error('lesson must be a single path segment (no slashes), e.g. lesson1');
  }
  return trimmed;
}

/**
 * Builds the S3 object key for an audio file:
 * `{prefix}[/{lesson}]/audio/{jobId}.mp3`
 *
 * Mirrors the key layout written by tts-batch/src/writer.ts.
 */
export function buildS3AudioKey(
  prefix: string,
  lesson: string | undefined,
  jobId: string
): string {
  const parts = [prefix, lesson, 'audio', `${jobId}.mp3`].filter(
    (p): p is string => Boolean(p)
  );
  return parts.join('/');
}
