/**
 * Dev-only remote debug logger for physical devices.
 *
 * A phone on the LAN cannot reach a debugger's ingest server bound to
 * `127.0.0.1` on the Mac, so this helper POSTs NDJSON log entries to places the
 * device *can* reach:
 *
 * 1. `${EXPO_PUBLIC_WEB_ORIGIN}/api/agent-debug-log` — Next.js dev route that
 *    appends to a local NDJSON file and optionally forwards to an ingest URL
 *    (`AGENT_DEBUG_INGEST_URL` on the web side).
 * 2. `EXPO_PUBLIC_AGENT_DEBUG_INGEST_URL` — a full ingest URL reachable from the
 *    device, e.g. the LAN relay from `npm run debug:relay`
 *    (`http://<mac-lan-ip>:17558/ingest/<session>`).
 *
 * Enabled only when `EXPO_PUBLIC_AGENT_DEBUG_LOG=1` AND the bundle is a dev
 * build (`__DEV__` on React Native, `NODE_ENV !== 'production'` elsewhere).
 * Otherwise it is a no-op, so call sites can be left in place while debugging
 * and removed before merge without affecting production behaviour.
 *
 * Never log secrets (tokens, API keys, PII).
 */
export interface AgentDebugLogPayload {
  /** `file.ts:label` — where the log originates. */
  location: string;
  message: string;
  data?: Record<string, unknown>;
  /** Tag the hypothesis this log is testing, if any. */
  hypothesisId?: string;
  /** Distinguish runs (e.g. `pre-fix` / `post-fix`). */
  runId?: string;
}

const isDevBuild = (): boolean => {
  const rnDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  if (typeof rnDev === 'boolean') return rnDev;
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
};

const isEnabled = (): boolean =>
  isDevBuild() &&
  typeof process !== 'undefined' &&
  process.env?.EXPO_PUBLIC_AGENT_DEBUG_LOG === '1';

/**
 * Send a structured debug log entry from a dev build to the local debug
 * collectors. No-op outside dev or when `EXPO_PUBLIC_AGENT_DEBUG_LOG` is unset.
 */
export function agentDebugLog(payload: AgentDebugLogPayload): void {
  if (!isEnabled()) return;

  const sessionId = process.env.EXPO_PUBLIC_AGENT_DEBUG_SESSION_ID ?? undefined;
  const body = JSON.stringify({
    ...(sessionId ? { sessionId } : {}),
    runId: payload.runId,
    hypothesisId: payload.hypothesisId,
    location: payload.location,
    message: payload.message,
    data: payload.data ?? {},
    timestamp: Date.now(),
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(sessionId ? { 'X-Debug-Session-Id': sessionId } : {}),
  };

  const origin = process.env.EXPO_PUBLIC_WEB_ORIGIN?.replace(/\/$/, '');
  if (origin) {
    fetch(`${origin}/api/agent-debug-log`, { method: 'POST', headers, body }).catch(
      () => {},
    );
  }

  const ingestUrl = process.env.EXPO_PUBLIC_AGENT_DEBUG_INGEST_URL;
  if (ingestUrl) {
    fetch(ingestUrl, { method: 'POST', headers, body }).catch(() => {});
  }
}
