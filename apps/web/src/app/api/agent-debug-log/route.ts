import { appendFile, mkdir } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Dev-only collector for `agentDebugLog` entries sent from physical devices
 * (see `packages/logic/src/agentDebugLog.ts`). The device can reach this
 * route via `EXPO_PUBLIC_WEB_ORIGIN`, whereas a debugger's ingest server bound
 * to `127.0.0.1` on the Mac is unreachable from the phone.
 *
 * - Appends each request body as one NDJSON line to `AGENT_DEBUG_LOG_PATH`
 *   (default: `<repo>/.cursor/agent-debug.log`).
 * - If `AGENT_DEBUG_INGEST_URL` is set, forwards the same body there
 *   (e.g. a Cursor debug-session ingest URL on localhost).
 *
 * Unauthenticated by design (the middleware exempts it in development only);
 * returns 404 in production.
 */
const DEFAULT_LOG_PATH = path.resolve(process.cwd(), '../../.cursor/agent-debug.log');

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }

  const line = (await req.text()).trim();
  if (line.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  const logPath = process.env.AGENT_DEBUG_LOG_PATH ?? DEFAULT_LOG_PATH;
  await mkdir(path.dirname(logPath), { recursive: true }).catch(() => {});
  await appendFile(logPath, `${line}\n`).catch(() => {});

  const ingestUrl = process.env.AGENT_DEBUG_INGEST_URL;
  if (ingestUrl) {
    const sessionId = req.headers.get('x-debug-session-id');
    fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'X-Debug-Session-Id': sessionId } : {}),
      },
      body: line,
    }).catch(() => {});
  }

  return new NextResponse(null, { status: 204 });
}
