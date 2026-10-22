#!/usr/bin/env node
/**
 * LAN → localhost TCP relay for device debug logging.
 *
 * Debug-session ingest servers (e.g. Cursor's) typically bind to
 * 127.0.0.1 only, so a physical phone on the LAN cannot POST to them. This
 * relay listens on all interfaces and pipes each connection to the local
 * ingest port, letting the device use
 * `http://<mac-lan-ip>:<RELAY_LISTEN_PORT>/ingest/<session>` as
 * `EXPO_PUBLIC_AGENT_DEBUG_INGEST_URL`.
 *
 * Usage:  npm run debug:relay
 * Env:    RELAY_LISTEN_PORT (default 17558)
 *         RELAY_TARGET_HOST (default 127.0.0.1)
 *         RELAY_TARGET_PORT (default 7558)
 *
 * Dev-only tooling; nothing in the apps depends on it at runtime.
 */
const net = require('net');

const LISTEN_PORT = Number(process.env.RELAY_LISTEN_PORT ?? 17558);
const TARGET_HOST = process.env.RELAY_TARGET_HOST ?? '127.0.0.1';
const TARGET_PORT = Number(process.env.RELAY_TARGET_PORT ?? 7558);

const server = net.createServer((client) => {
  const upstream = net.connect(TARGET_PORT, TARGET_HOST, () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
});

server.on('error', (err) => {
  console.error(`[debug-log-relay] ${err.message}`);
  process.exit(1);
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(
    `[debug-log-relay] listening on 0.0.0.0:${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`,
  );
});
