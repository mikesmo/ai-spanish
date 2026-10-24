import * as FileSystem from "expo-file-system";
import { supabase } from "./supabase";

export type PackageAudioFileKey = "success" | "success1";

/** In-flight downloads so concurrent prefetch/play share one request. */
const inFlight = new Map<PackageAudioFileKey, Promise<string>>();

function destPathForKey(key: PackageAudioFileKey): string {
  const base = FileSystem.cacheDirectory;
  if (!base) {
    throw new Error("FileSystem.cacheDirectory is unavailable.");
  }
  return `${base}package-audio-${key}.mp3`;
}

async function downloadPackageAudio(key: PackageAudioFileKey): Promise<string> {
  const origin = process.env.EXPO_PUBLIC_WEB_ORIGIN?.replace(/\/$/, "");
  if (!origin) {
    throw new Error("EXPO_PUBLIC_WEB_ORIGIN is not set.");
  }
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not signed in.");
  }

  const dest = destPathForKey(key);
  const url = `${origin}/api/package-audio?file=${encodeURIComponent(key)}`;
  const result = await FileSystem.downloadAsync(url, dest, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  return result.uri;
}

/**
 * Downloads UX audio from the web app's authenticated package-audio API into cache.
 * Returns a `file://` URI suitable for expo-av. Reuses an on-disk file when present.
 */
export async function fetchPackageAudioUri(
  key: PackageAudioFileKey,
): Promise<string> {
  const dest = destPathForKey(key);
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists && !info.isDirectory && (info.size ?? 0) > 0) {
    return info.uri;
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = downloadPackageAudio(key).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, pending);
  }
  return pending;
}

/** Warms the on-disk cache for a package-audio key. */
export function prefetchPackageAudio(key: PackageAudioFileKey): Promise<string> {
  return fetchPackageAudioUri(key);
}
