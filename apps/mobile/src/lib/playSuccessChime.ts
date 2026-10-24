import { Audio } from "expo-av";
import {
  fetchPackageAudioUri,
  prefetchPackageAudio,
} from "./fetchPackageAudioUri";

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

export interface PlaySuccessChimeOptions {
  /** Called when playback is about to start (after the clip is ready). */
  onStart?: () => void;
}

/** Prefetches the success chime into the on-disk cache. */
export function prefetchSuccessChime(): Promise<string> {
  return prefetchPackageAudio("success");
}

/**
 * Plays the success clip from the authenticated package-audio API.
 */
export async function playSuccessChime(
  signal: AbortSignal,
  opts?: PlaySuccessChimeOptions,
): Promise<void> {
  if (signal.aborted) throw abortError();

  const uri = await fetchPackageAudioUri("success");
  if (signal.aborted) throw abortError();

  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const { sound } = await Audio.Sound.createAsync({ uri });

  let settled = false;

  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        fn();
      };

      const onAbort = () => {
        finish(() => {
          void sound.stopAsync().catch(() => {});
          reject(abortError());
        });
      };

      signal.addEventListener("abort", onAbort, { once: true });

      sound.setOnPlaybackStatusUpdate((status) => {
        if (settled) return;
        if (!status.isLoaded) {
          if ("error" in status && status.error) {
            finish(() => reject(new Error(String(status.error))));
          }
          return;
        }
        if (status.didJustFinish) {
          finish(() => resolve());
        }
      });

      opts?.onStart?.();
      void sound.playAsync().catch((err: unknown) => {
        finish(() =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
      });
    });
  } finally {
    await sound.unloadAsync().catch(() => {});
  }
}
