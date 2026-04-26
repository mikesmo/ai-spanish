/**
 * Server-minted Deepgram listen keys for React Native (see web `/api/authenticate`).
 * Must stay in sync with {@link DEEPGRAM_LISTEN_KEY_MAX_AGE_MS} and server TTL.
 */
export const DEEPGRAM_LISTEN_KEY_MAX_AGE_MS = 20_000;

type KeyEntry = { key: string; fetchedAt: number };

let nextKey: KeyEntry | null = null;
let inFlight: Promise<string> | null = null;

function getWebOrigin(): string {
  return (process.env.EXPO_PUBLIC_WEB_ORIGIN ?? '').replace(/\/$/, '');
}

async function fetchListenKeyFromServer(): Promise<string> {
  const origin = getWebOrigin();
  if (!origin) {
    throw new Error(
      'EXPO_PUBLIC_WEB_ORIGIN is not set. Required to mint Deepgram listen keys.',
    );
  }
  const response = await fetch(`${origin}/api/authenticate`, {
    cache: 'no-store',
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to get Deepgram auth key: ${response.status}`);
  }
  if (
    typeof result !== 'object' ||
    result === null ||
    !('key' in result) ||
    typeof (result as { key: unknown }).key !== 'string' ||
    (result as { key: string }).key.length === 0
  ) {
    throw new Error('Deepgram authenticate response missing key');
  }
  return (result as { key: string }).key;
}

function getFreshKeySingleFlight(): Promise<string> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = (async () => {
    try {
      return await fetchListenKeyFromServer();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function resolveKeyForListen(): Promise<string> {
  const cached = nextKey;
  if (
    cached &&
    Date.now() - cached.fetchedAt < DEEPGRAM_LISTEN_KEY_MAX_AGE_MS
  ) {
    nextKey = null;
    return cached.key;
  }
  nextKey = null;
  return getFreshKeySingleFlight();
}

export function prefetchListenKey(): void {
  void (async () => {
    try {
      const key = await fetchListenKeyFromServer();
      nextKey = { key, fetchedAt: Date.now() };
    } catch (err) {
      console.error('[Deepgram] prefetch listen key failed:', err);
    }
  })();
}
