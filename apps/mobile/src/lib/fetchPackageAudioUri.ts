import * as FileSystem from "expo-file-system";
import { supabase } from "./supabase";

export type PackageAudioFileKey = "no-you-try" | "success" | "success1";

/**
 * Downloads UX audio from the web app's authenticated package-audio API into cache.
 * Returns a `file://` URI suitable for expo-av.
 */
export async function fetchPackageAudioUri(
  key: PackageAudioFileKey,
): Promise<string> {
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

  const base = FileSystem.cacheDirectory;
  if (!base) {
    throw new Error("FileSystem.cacheDirectory is unavailable.");
  }

  const url = `${origin}/api/package-audio?file=${encodeURIComponent(key)}`;
  const dest = `${base}package-audio-${key}.mp3`;
  const result = await FileSystem.downloadAsync(url, dest, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  return result.uri;
}
