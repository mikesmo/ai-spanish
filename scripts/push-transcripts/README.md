# Push transcripts CLI (`@ai-spanish/push-transcripts`)

Loads phrase JSON from **`apps/web/data/transcripts/{lessonId}.json`** and **upserts** rows in Supabase **`public.lesson_transcripts`** via **`@supabase/supabase-js`** and the **service role** key.

This script does **not** call the Next.js **`/api/transcript`** route (no Bearer user JWT, no running web server).

Run commands from the **monorepo root** (`ai-spanish/`). Paths are resolved relative to that root.

## System requirements

- **Node.js** (see repo root)

## Setup

1. Install dependencies at the repo root: **`npm install`**
2. Copy **[`.env.example`](.env.example)** to **`.env`** in this directory and set **`NEXT_PUBLIC_SUPABASE_URL`** and **`SUPABASE_SERVICE_ROLE_KEY`**. Repo **`.gitignore`** ignores **`.env`**.
3. Apply Supabase migrations so **`lesson_id`** matches your ids (see [`supabase/migrations/`](../../supabase/migrations/)).

## Security

The **service role** key bypasses Row Level Security. Use only in trusted environments (same posture as **[`migrate-lesson-weights`](../migrate-lesson-weights/src/index.ts)** and **`tts-batch`**). Never commit keys or expose them to client bundles.

## Transcript files on disk

- **`apps/web/data/transcripts/{lessonId}.json`** — **`lessonId`**: positive integer string, **no leading zeros** (**`1.json`**, **`3.json`**).
- Names like **`lesson1.json`** are **skipped**; use **`1.json`** for lesson **1**.
- Body: JSON array matching **`transcriptResponseSchema`** / **`TranscriptResponse`** (same shape as **`GET /api/transcript`**).

Files are processed in numeric **`lessonId`** order.

## Workflow

From the **monorepo root**, with **`.env`** configured or variables exported:

```bash
npm run push:transcripts
```

Or:

```bash
npm run start --workspace=@ai-spanish/push-transcripts
```

Each lesson logs **`Upserted lesson N (... phrases)`**. Existing **`lesson_id`** rows are replaced; new ids insert a row.

## Environment variables

| Variable | When |
|----------|------|
| **`NEXT_PUBLIC_SUPABASE_URL`** | **Required.** Supabase project URL. |
| **`SUPABASE_SERVICE_ROLE_KEY`** | **Required.** Service role secret for **`lesson_transcripts`** writes. |

Loaded from **`scripts/push-transcripts/.env`** (see **`dotenv`** in **`src/index.ts`**) or your shell.

## Typecheck

```bash
npm run typecheck --workspace=@ai-spanish/push-transcripts
```

## See also

- [`apps/web/README.md`](../../apps/web/README.md) — **`PUT /api/transcript`** for authenticated HTTP updates  
- [`migrate-lesson-weights/src/supabase-lesson-transcript.ts`](../migrate-lesson-weights/src/supabase-lesson-transcript.ts) — same upsert pattern  
- [`scripts/tts-batch/README.md`](../tts-batch/README.md) — batch TTS from transcripts
