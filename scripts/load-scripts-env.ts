import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

/**
 * Finds monorepo root (package.json with `"name": "ai-spanish-workspace"`), walking up from cwd.
 */
function resolveRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 14; i++) {
    try {
      const pkgPath = path.join(dir, 'package.json');
      const raw = fs.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(raw) as { name?: string };
      if (pkg.name === 'ai-spanish-workspace') {
        return dir;
      }
    } catch {
      /* no package.json or invalid */
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return process.cwd();
}

/**
 * Loads monorepo-root `.env.scripts`, then cwd `.env` for any keys not set there.
 * Call once at process startup before reading `process.env` (shared by push-transcripts,
 * tts-batch, migrate-lesson-weights).
 */
export function loadScriptsEnv(): void {
  const repoRoot = resolveRepoRoot();
  dotenv.config({ path: path.join(repoRoot, '.env.scripts') });
  dotenv.config();
}
