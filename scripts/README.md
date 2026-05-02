# Scripts (`scripts/`)

Operational CLIs for transcripts, lesson migration, and batch TTS. Run them from the **monorepo root** (`ai-spanish/`) via **[`package.json`](../package.json)** npm scripts unless a subdirectory README says otherwise.

## Environment variables

All script entrypoints below call **`loadScriptsEnv()`** from **[`load-scripts-env.ts`](load-scripts-env.ts)** at startup:

1. **Canonical file:** **[`.env.scripts`](../.env.scripts)** at the **repo root** (next to the workspace `package.json`). Gitignored — do not commit secrets.
2. **Template:** **[`.env.scripts.example`](../.env.scripts.example)** — copy to **`.env.scripts`** and fill in values (Supabase URL + service role, Deepgram, AWS, etc.).
3. **Discovery:** The loader walks up from **`process.cwd()`** until it finds **`package.json`** with **`"name": "ai-spanish-workspace"`**, then loads **`<repo>/.env.scripts`**.
4. **Optional fallback:** A second **`dotenv.config()`** loads **`.env` in the current working directory** only for variables not already set — prefer **`.env.scripts`** for script configuration.

**`dotenv`** is a **root devDependency**; individual script packages do not duplicate it.

Do **not** confuse this with **`apps/web/.env.local`** (Next.js) — that stays separate.

## Packages

| Directory | Purpose | Detailed docs |
|-----------|---------|----------------|
| **`tts-batch/`** | Batch Deepgram TTS: generate lesson audio clips, manifest, optional S3 upload, verification helpers. | [`tts-batch/README.md`](tts-batch/README.md) |
| **`sync-transcripts/`** | **Push:** upsert into **`lesson_transcripts`** from default **`input/`** at repo root, or **`PUSH_TRANSCRIPTS_SOURCE_DIR`** / **`--source-dir`**, or one **`--file`**. **Pull:** **`npm run pull:transcripts`** → **`{base}/{id}.json`**. | [`sync-transcripts/README.md`](sync-transcripts/README.md) |
| **`migrate-lesson-weights/`** | Idempotent normalization: stable phrase **`name`** slugs and per-word **`weight`** from **`POS_WEIGHTS`**; reads/writes JSON files or Supabase **`lesson_transcripts`** via **`TRANSCRIPT_LESSON_ID`**. No separate README — see **`src/index.ts`** header JSDoc and **`npm run migrate:lesson1`**. | _(inline docs)_ |

## Root npm shortcuts

From the repo root:

```bash
npm run tts:batch -- --help
npm run push:transcripts
npm run push:transcripts -- --help
npm run pull:transcripts
npm run pull:transcripts -- 1
npm run migrate:lesson1 -- path/to/lesson.json
```

Equivalent workspace entrypoints:

```bash
npm run start --workspace=@ai-spanish/tts-batch -- --help
npm run start --workspace=@ai-spanish/sync-transcripts
npm run push:transcripts -- --help
npm run pull:transcripts -- --help
npm run start --workspace=@ai-spanish/migrate-lesson-weights -- path/to/lesson.json
```
