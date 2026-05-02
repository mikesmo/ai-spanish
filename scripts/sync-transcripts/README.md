# Sync transcripts (`@ai-spanish/sync-transcripts`)

**Push:** Upserts phrase JSON from disk into Supabase **`lesson_transcripts`**. Default scan dir is **`input/`** at the repo root; override with **`PUSH_TRANSCRIPTS_SOURCE_DIR`** or **`--source-dir`**. Push one file with **`--file`** / **`-f`**.

**Pull:** Exports **`lesson_transcripts`** from Supabase to **`{base}/<id>.json`** (see root **`npm run pull:transcripts`**).

These scripts do **not** call the Next.js **`/api/transcript`** route (no Bearer user JWT, no running web server).

Run commands from the **monorepo root** (`ai-spanish/`). Paths are resolved relative to that root.

## System requirements

- **Node.js** (see repo root)

## Setup

1. Install dependencies at the repo root: **`npm install`**
2. Copy **[`.env.scripts.example`](../../.env.scripts.example)** at the **monorepo root** to **`.env.scripts`** and set **`NEXT_PUBLIC_SUPABASE_URL`** and **`SUPABASE_SERVICE_ROLE_KEY`** (and any other vars you need). Root **`.gitignore`** ignores **`.env.scripts`**.
3. Apply Supabase migrations so **`lesson_id`** matches your ids (see [`supabase/migrations/`](../../supabase/migrations/)).

## Security

The **service role** key bypasses Row Level Security. Use only in trusted environments (same posture as **[`migrate-lesson-weights`](../migrate-lesson-weights/src/index.ts)** and **`tts-batch`**). Never commit keys or expose them to client bundles.

## Transcript files on disk (push)

- **Bulk:** every **`{lessonId}.json`** in the resolved source directory — **`lessonId`**: positive integer string, **no leading zeros** (**`1.json`**, **`3.json`**).
- **Single file:** **`--file path/to/1.json`** (or **`-f`**); **`lesson_id`** in the database is the filename stem (**`1.json`** → **`1`**).
- Names like **`lesson1.json`** are **skipped** in bulk (invalid id); use **`1.json`** for lesson **1**.
- Body: JSON array matching **`transcriptResponseSchema`** / **`TranscriptResponse`** (same shape as **`GET /api/transcript`**).

Bulk runs process files in numeric **`lessonId`** order.

## Workflow — push

From the **monorepo root**, with **`.env.scripts`** configured or variables exported.

**Bulk** — upserts every valid **`*.json`** in the source directory:

```bash
npm run push:transcripts
```

**Source directory** (bulk only), in order:

1. **`--source-dir <path>`** (relative to cwd unless absolute), e.g.  
   `npm run push:transcripts -- --source-dir output/transcripts`
2. **`PUSH_TRANSCRIPTS_SOURCE_DIR`** in **`.env.scripts`** when **`--source-dir`** is not passed
3. **`input/`** under the repo root (default)

**Single file** — **`--file`** / **`-f`** wins over bulk; **`--source-dir`** is ignored:

```bash
npm run push:transcripts -- --file output/transcripts/1.json
npm run push:transcripts -- -f input/1.json
```

Or via workspace:

```bash
npm run start --workspace=@ai-spanish/sync-transcripts
```

```bash
npm run push:transcripts -- --help
```

Each lesson logs **`Upserted lesson N (... phrases)`**. Existing **`lesson_id`** rows are replaced; new ids insert a row.

## Workflow — pull

From the **monorepo root**, with **`.env.scripts`** (or your shell) providing Supabase credentials. Exported files are **`{base}/<lessonId>.json`**.

**Pull every lesson** in **`lesson_transcripts`**:

```bash
npm run pull:transcripts
```

**Pull lesson `1` only** (writes **`{base}/1.json`**):

```bash
npm run pull:transcripts -- 1
```

**Output base `{base}`** is chosen in this order:

1. **`--output-dir <path>`** on the command line (overrides the env var), e.g.  
   `npm run pull:transcripts -- --output-dir /path/to/output 1` → **`/path/to/output/1.json`**
2. **`PULL_TRANSCRIPTS_OUTPUT_DIR`** in **`.env.scripts`** (see below) or exported in the shell when **`--output-dir`** is not passed
3. **`process.cwd()`** if neither is set

Example using only the environment variable for **`{base}`** — add to repo-root **`.env.scripts`**:

```env
PULL_TRANSCRIPTS_OUTPUT_DIR=/path/to/output
```

Then:

```bash
npm run pull:transcripts -- 1
# → /path/to/output/1.json
```

```bash
npm run pull:transcripts -- --help
```

## Environment variables

| Variable | When |
|----------|------|
| **`NEXT_PUBLIC_SUPABASE_URL`** | **Required** for push and pull. Supabase project URL. |
| **`SUPABASE_SERVICE_ROLE_KEY`** | **Required** for push and pull. Service role secret for **`lesson_transcripts`**. |
| **`PULL_TRANSCRIPTS_OUTPUT_DIR`** | **Optional** for pull: directory **`{base}`**; each lesson is written as **`{base}/{id}.json`**. Ignored if **`--output-dir`** is passed. |
| **`PUSH_TRANSCRIPTS_SOURCE_DIR`** | **Optional** for bulk push: directory scanned for transcript JSON named by lesson id (e.g. **`1.json`**). Ignored if **`--source-dir`** or **`--file`** / **`-f`** is passed. |

Loaded from repo-root **`.env.scripts`** via **`scripts/load-scripts-env.ts`**, or set variables in your shell. Relative paths in **`PULL_TRANSCRIPTS_OUTPUT_DIR`** and **`PUSH_TRANSCRIPTS_SOURCE_DIR`** resolve from the process cwd when the script runs.

## Typecheck

```bash
npm run typecheck --workspace=@ai-spanish/sync-transcripts
```

## See also

- [`apps/web/README.md`](../../apps/web/README.md) — **`PUT /api/transcript`** for authenticated HTTP updates  
- [`migrate-lesson-weights/src/supabase-lesson-transcript.ts`](../migrate-lesson-weights/src/supabase-lesson-transcript.ts) — shared upsert/fetch via **`scripts/lib`**  
- [`scripts/tts-batch/README.md`](../tts-batch/README.md) — batch TTS from transcripts
