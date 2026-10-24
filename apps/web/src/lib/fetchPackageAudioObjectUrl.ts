export type PackageAudioFileKey = 'success' | 'success1';

/** In-flight or resolved blob URLs — reused across plays (do not revoke while cached). */
const objectUrlCache = new Map<PackageAudioFileKey, Promise<string>>();

async function fetchFreshObjectUrl(key: PackageAudioFileKey): Promise<string> {
  const params = new URLSearchParams({ file: key });
  const res = await fetch(`/api/package-audio?${params}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Failed to load audio (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Loads UX audio from the authenticated package-audio API and returns a blob URL for HTML Audio.
 * Results are cached in-memory; do not revoke the returned URL.
 */
export async function fetchPackageAudioObjectUrl(key: PackageAudioFileKey): Promise<string> {
  let pending = objectUrlCache.get(key);
  if (!pending) {
    pending = fetchFreshObjectUrl(key).catch((err: unknown) => {
      objectUrlCache.delete(key);
      throw err;
    });
    objectUrlCache.set(key, pending);
  }
  return pending;
}

/** Warms the in-memory blob-URL cache for a package-audio key. */
export function prefetchPackageAudio(key: PackageAudioFileKey): Promise<string> {
  return fetchPackageAudioObjectUrl(key);
}
