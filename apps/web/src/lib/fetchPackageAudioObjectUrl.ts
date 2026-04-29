export type PackageAudioFileKey = 'no-you-try' | 'success' | 'success1';

/**
 * Loads UX audio from the authenticated package-audio API and returns a blob URL for HTML Audio.
 * Caller must revoke the URL when done.
 */
export async function fetchPackageAudioObjectUrl(key: PackageAudioFileKey): Promise<string> {
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
