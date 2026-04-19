/**
 * Short two-tone chime for a correct answer. Resolves when playback ends.
 * Aborts cleanly when `signal` is aborted (stops scheduling / closes context).
 */
export async function playSuccessChime(signal: AbortSignal): Promise<void> {
  if (typeof window === "undefined") return;

  const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;

  const ctx = new AudioContextCtor();
  const totalSec = 0.35;

  const cleanup = async () => {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
  };

  if (signal.aborted) {
    await cleanup();
    throw new DOMException("Aborted", "AbortError");
  }

  try {
    await ctx.resume();
  } catch {
    /* may fail if no user gesture; still try to play */
  }

  const now = ctx.currentTime;
  const scheduleTone = (freq: number, start: number, duration: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    const t0 = now + start;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.start(t0);
    osc.stop(t0 + duration);
  };

  scheduleTone(523.25, 0, 0.14);
  scheduleTone(659.25, 0.1, 0.2);

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timer);
      void cleanup().then(() => reject(new DOMException("Aborted", "AbortError")));
    };

    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      void cleanup().then(() => resolve());
    }, totalSec * 1000);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
