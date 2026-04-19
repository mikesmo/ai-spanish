import successChimeUrl from "@ai-spanish/assets/success.mp3";

/**
 * Plays shared `packages/assets/success.mp3`. Resolves when playback ends.
 * Aborts cleanly when `signal` is aborted.
 */
export async function playSuccessChime(signal: AbortSignal): Promise<void> {
  if (typeof window === "undefined") return;
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const audio = new Audio(successChimeUrl);

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
      reject(new Error("Success chime failed to load or play"));
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
