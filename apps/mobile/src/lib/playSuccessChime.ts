import { Audio } from "expo-av";

// Shared `packages/assets/success.mp3` via workspace package.
const SUCCESS_SOUND = require("@ai-spanish/assets/success.mp3") as number;

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

/**
 * Plays the success clip; resolves when playback finishes.
 * On abort: stops/unloads and rejects with AbortError.
 */
export async function playSuccessChime(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();

  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const { sound } = await Audio.Sound.createAsync(SUCCESS_SOUND);

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

      void sound.playAsync().catch((err: unknown) => {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      });
    });
  } finally {
    await sound.unloadAsync().catch(() => {});
  }
}
