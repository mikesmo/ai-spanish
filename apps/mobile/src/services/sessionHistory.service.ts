import type { HistoryEntry } from "@ai-spanish/logic";

const WEB_ORIGIN = process.env.EXPO_PUBLIC_WEB_ORIGIN;

/**
 * Posts a single HistoryEntry to the web app's dev-only session-history
 * endpoint. Only call this in dev builds (__DEV__); the endpoint returns 404
 * in production.
 *
 * Failures are non-fatal—returns false and logs a warning rather than
 * throwing, so a network issue never interrupts the lesson flow.
 */
export async function postSessionHistoryEntry(
  lessonId: string,
  entry: HistoryEntry,
): Promise<void> {
  if (!WEB_ORIGIN) {
    console.warn(
      "[sessionHistory] EXPO_PUBLIC_WEB_ORIGIN is not set — cannot post session history.",
    );
    return;
  }

  const url = `${WEB_ORIGIN.replace(/\/$/, "")}/api/session-history`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId, entry }),
    });

    if (!response.ok) {
      if (response.status === 404 || response.status === 403) {
        // Expected when web app is running in production mode.
        console.warn(
          `[sessionHistory] API returned ${response.status} — is the web app running in dev mode?`,
        );
      } else {
        console.warn(
          `[sessionHistory] POST failed with status ${response.status}.`,
        );
      }
    }
  } catch (err) {
    console.warn("[sessionHistory] POST failed:", err);
  }
}
