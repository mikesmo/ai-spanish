import {
  AUDIO_BATCH_PRESIGN_PATH,
  audioBatchPresignResponseSchema,
  isAudioClipSegment,
  lessonAudioClipId,
  type AudioBatchPresignRequest,
  type Language,
  type LessonAudioClip,
  type TtsAdapterOptions,
} from '@ai-spanish/logic';

export interface AudioUrlResponse {
  url: string;
}

export function segmentsForLanguage(
  lang: Language,
  options?: TtsAdapterOptions
): string[] {
  if (lang === 'en') {
    if (options?.englishSegmentOverride) {
      return [options.englishSegmentOverride];
    }
    const segs = options?.englishUseFirstIntro
      ? ['first-intro']
      : ['second-intro'];
    if (options?.englishAppendQuestion) {
      segs.push('question');
    }
    return segs;
  }
  if (options?.spanishSegmentOverride) {
    return [options.spanishSegmentOverride];
  }
  return ['answer'];
}

export const PRESIGNED_URL_CACHE_TTL_MS = 240_000;

/** Treat batch URLs as expired this long before the server's `expiresIn`. */
const BATCH_EXPIRY_MARGIN_MS = 60_000;

/**
 * Fetches a presigned S3 URL for a single audio segment.
 *
 * @param baseUrl - Origin to prepend, e.g. "http://192.168.1.5:3000" for native
 *                  or "" for web (same-origin relative fetch).
 * @param phraseName - Phrase slug used as the clip stem (e.g. `perdona`); the
 *                  S3 key resolves to `{prefix}[/{lesson}]/audio/{phraseName}-{segment}.mp3`.
 *
 * Returns null when the segment does not exist (e.g. empty intro text skipped
 * at batch time), when the API is unconfigured (503), or on network error.
 */
export async function fetchPresignedUrl(
  baseUrl: string,
  phraseName: string,
  segment: string,
  signal?: AbortSignal,
  s3LessonSegment?: string,
  authHeaders?: Record<string, string>
): Promise<string | null> {
  const params = new URLSearchParams({ phrase: phraseName, segment });
  if (s3LessonSegment != null && s3LessonSegment !== '') {
    params.set('lesson', s3LessonSegment);
  }
  const trimmed = baseUrl.replace(/\/$/, '');
  try {
    const response = await fetch(
      `${trimmed}/api/audio?${params.toString()}`,
      {
        signal,
        ...(Object.keys(authHeaders ?? {}).length > 0
          ? { headers: authHeaders }
          : {}),
      },
    );
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as AudioUrlResponse;
    return data.url ?? null;
  } catch {
    return null;
  }
}

export interface BatchPresignResult {
  /** Clip id → presigned URL + content version. Missing clips are absent. */
  clips: Map<string, { url: string; version: string }>;
  expiresAt: number;
}

/**
 * Presigns every clip of a lesson in one `POST /api/audio/batch` request.
 * Returns null on any failure (network, auth, unconfigured S3, bad payload).
 */
export async function fetchBatchPresignedUrls(
  baseUrl: string,
  clips: readonly LessonAudioClip[],
  s3LessonSegment?: string,
  authHeaders?: Record<string, string>
): Promise<BatchPresignResult | null> {
  const body: AudioBatchPresignRequest = {
    clips: clips.map((c) => ({ phrase: c.phraseName, segment: c.segment })),
    ...(s3LessonSegment != null && s3LessonSegment !== ''
      ? { lesson: s3LessonSegment }
      : {}),
  };
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}${AUDIO_BATCH_PRESIGN_PATH}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      console.warn(`[s3 tts] batch presign failed: HTTP ${response.status}`);
      return null;
    }
    const parsed = audioBatchPresignResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn('[s3 tts] batch presign returned an unexpected payload');
      return null;
    }
    return {
      clips: new Map(Object.entries(parsed.data.clips)),
      expiresAt: Date.now() + parsed.data.expiresIn * 1000 - BATCH_EXPIRY_MARGIN_MS,
    };
  } catch (err) {
    console.warn('[s3 tts] batch presign error:', err);
    return null;
  }
}

export interface ResolvedClip {
  url: string;
  /** Content version (S3 ETag) when known from the batch presign; null otherwise. */
  version: string | null;
}

export interface S3ClipUrlResolver {
  /**
   * Presigned URL for one clip. Waits for an in-flight lesson batch first, then
   * uses its result; falls back to a single `/api/audio` presign when the
   * batch is absent, failed, or expired. Returns null for missing clips.
   */
  resolve: (
    phraseName: string,
    segment: string,
    s3LessonSegment: string | undefined,
    signal?: AbortSignal
  ) => Promise<ResolvedClip | null>;
  /**
   * Presigns `clips` in one request (deduplicated per lesson while in flight or
   * unexpired). Resolves true when the batch result is usable.
   */
  presignLesson: (
    clips: readonly LessonAudioClip[],
    s3LessonSegment: string | undefined
  ) => Promise<boolean>;
}

/** Cache key shared by the URL resolver and platform file/blob caches. */
export function s3ClipCacheKey(
  phraseName: string,
  segment: string,
  s3LessonSegment: string | undefined
): string {
  return `${s3LessonSegment ?? ''}|${phraseName}-${segment}`;
}

type CachedClip = ResolvedClip & { expiresAt: number };

interface LessonBatchState {
  promise: Promise<boolean>;
  expiresAt: number;
  /** Requested clip keys the batch reported as absent from S3. */
  missing: Set<string>;
}

/**
 * Shared presigned-URL cache for the web and native S3 TTS adapters.
 * Transport differences (origin, auth headers) are injected.
 */
export function createS3ClipUrlResolver(transport: {
  fetchSingle: (
    phraseName: string,
    segment: string,
    s3LessonSegment: string | undefined,
    signal: AbortSignal | undefined
  ) => Promise<string | null>;
  fetchBatch: (
    clips: readonly LessonAudioClip[],
    s3LessonSegment: string | undefined
  ) => Promise<BatchPresignResult | null>;
}): S3ClipUrlResolver {
  const urls = new Map<string, CachedClip>();
  const batches = new Map<string, LessonBatchState>();

  const getCached = (key: string): CachedClip | null => {
    const entry = urls.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      urls.delete(key);
      return null;
    }
    return entry;
  };

  const presignLesson: S3ClipUrlResolver['presignLesson'] = (clips, s3LessonSegment) => {
    const lessonKey = s3LessonSegment ?? '';
    const existing = batches.get(lessonKey);
    if (existing && Date.now() <= existing.expiresAt) return existing.promise;

    const state: LessonBatchState = {
      promise: Promise.resolve(false),
      expiresAt: Number.POSITIVE_INFINITY,
      missing: new Set(),
    };
    state.promise = (async () => {
      const result = await transport.fetchBatch(clips, s3LessonSegment);
      if (!result) {
        batches.delete(lessonKey);
        return false;
      }
      state.expiresAt = result.expiresAt;
      for (const clip of clips) {
        const id = lessonAudioClipId(clip.phraseName, clip.segment);
        const key = s3ClipCacheKey(clip.phraseName, clip.segment, s3LessonSegment);
        const hit = result.clips.get(id);
        if (hit) {
          urls.set(key, { ...hit, expiresAt: result.expiresAt });
        } else {
          state.missing.add(key);
        }
      }
      return true;
    })();
    batches.set(lessonKey, state);
    return state.promise;
  };

  const resolve: S3ClipUrlResolver['resolve'] = async (
    phraseName,
    segment,
    s3LessonSegment,
    signal
  ) => {
    const key = s3ClipCacheKey(phraseName, segment, s3LessonSegment);
    const batch = batches.get(s3LessonSegment ?? '');
    if (batch) await batch.promise;
    if (signal?.aborted) return null;

    const usableBatch = batches.get(s3LessonSegment ?? '');
    if (
      usableBatch &&
      Date.now() <= usableBatch.expiresAt &&
      usableBatch.missing.has(key)
    ) {
      return null;
    }
    const cached = getCached(key);
    if (cached) return cached;

    if (!isAudioClipSegment(segment)) return null;
    const url = await transport.fetchSingle(phraseName, segment, s3LessonSegment, signal);
    if (!url) return null;
    const resolved: CachedClip = {
      url,
      version: null,
      expiresAt: Date.now() + PRESIGNED_URL_CACHE_TTL_MS,
    };
    urls.set(key, resolved);
    return resolved;
  };

  return { resolve, presignLesson };
}
