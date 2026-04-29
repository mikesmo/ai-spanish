import { fetchPackageAudioObjectUrl } from '@/lib/fetchPackageAudioObjectUrl';

/**
 * Plays packages/assets/success.mp3 via the authenticated package-audio API.
 * Resolves when playback ends. Aborts cleanly when `signal` is aborted.
 */
export async function playSuccessChime(signal: AbortSignal): Promise<void> {
  if (typeof window === 'undefined') return;
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  let objectUrl: string | null = null;

  try {
    objectUrl = await fetchPackageAudioObjectUrl('success');
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
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new DOMException('Aborted', 'AbortError'));
      };

      const onEnded = () => {
        cleanup();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve();
      };

      const onError = () => {
        cleanup();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new Error('Success chime failed to load or play'));
      };

      signal.addEventListener('abort', onAbort, { once: true });
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      void audio.play().catch((err: unknown) => {
        cleanup();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  } catch (err) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    throw err;
  }
}
