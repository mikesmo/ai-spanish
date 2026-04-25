import noYouTryUrl from "@ai-spanish/assets/no-you-try.mp3";

/**
 * Plays shared `packages/assets/no-you-try.mp3`. Resolves when playback ends.
 * Aborts cleanly when `signal` is aborted.
 */
export async function playRecordingPrimingAudio(signal: AbortSignal): Promise<void> {
  if (typeof window === "undefined") return;
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const audio = new Audio(noYouTryUrl);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };

    const onAbort = () => {
      cleanup();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const onEnded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Recording priming audio failed to load or play"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    void audio.play().catch((err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
