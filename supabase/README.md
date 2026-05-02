# Supabase (database migrations)

Lesson **schema** (e.g. `lesson_transcripts`, **`course_levels`**, **`lesson_catalog`**) lives in **`migrations/`**. **Phrase JSON is not committed in migrations** — after a reset, load transcript rows with **`npm run push:transcripts`** from [`input/lessons/`](../input/lessons) (or **`--file`** / **`PUSH_TRANSCRIPTS_SOURCE_DIR`**). See **[`scripts/sync-transcripts/README.md`](../scripts/sync-transcripts/README.md)**.

**Lesson list in the app** comes from **`lesson_catalog`** (joined with **`course_levels`**). The migration seeds **`course_levels`** (`beginner`) and tries to seed **`lesson_catalog`** for lessons **1** and **2** only when those **`lesson_transcripts`** rows already exist. After a **`db reset`**, run **`npm run push:transcripts`** first, then run **[`seed_lesson_catalog_after_transcripts.sql`](seed_lesson_catalog_after_transcripts.sql)** (or equivalent `INSERT`s) so the home screen lists lessons.

Apply migrations with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
# Link once (sets project ref)
supabase link --project-ref YOUR_PROJECT_REF

# Push local migrations to the linked remote database
supabase db push
```

For a fresh local Postgres via Docker:

```bash
supabase start
supabase db reset
```

Then populate **`lesson_transcripts`** from the monorepo root (with **`.env.scripts`**):

```bash
npm run push:transcripts
```

Do **not** hand-edit production schema in the dashboard only — keep DDL in versioned SQL here.

**Rebasing migrations:** If a remote project already applied older migrations that embedded seed JSON or the separate `lesson_id` expand migration, coordinate a fresh migration history (`db reset` / new project / `migration repair`) before relying on this layout.

Operational scripts (**`npm run push:transcripts`**, **`npm run pull:transcripts`**, **`tts:batch`**, **`migrate:lesson1`**) load secrets from repo-root **`.env.scripts`**; copy **[`.env.scripts.example`](../.env.scripts.example)** to **`.env.scripts`** at the monorepo root (gitignored).
