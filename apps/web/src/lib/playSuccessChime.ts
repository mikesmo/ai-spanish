import {
  fetchPackageAudioObjectUrl,
  prefetchPackageAudio,
} from '@/lib/fetchPackageAudioObjectUrl';

export interface PlaySuccessChimeOptions {
  /** Called when playback is about to start (after the clip is ready). */
  onStart?: () => void;
}

/** Prefetches the success chime into the in-memory blob-URL cache. */
export function prefetchSuccessChime(): Promise<string> {
  return prefetchPackageAudio('success');
}

/**
 * Plays packages/assets/success.mp3 via the authenticated package-audio API.
 * Resolves when playback ends. Aborts cleanly when `signal` is aborted.
 */
export async function playSuccessChime(
  signal: AbortSignal,
  opts?: PlaySuccessChimeOptions,
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const objectUrl = await fetchPackageAudioObjectUrl('success');
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const audio = new Audio(objectUrl);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };

    const onAbort = () => {
      cleanup();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const onEnded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Success chime failed to load or play'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    opts?.onStart?.();
    void audio.play().catch((err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
