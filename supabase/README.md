# Supabase (database migrations)

Lesson **schema** (e.g. `lesson_transcripts`) lives in **`migrations/`**. **Phrase JSON is not committed in migrations** — after a reset, load rows with **`npm run push:transcripts`** from [`apps/web/data/transcripts/`](../apps/web/data/transcripts) (or **`--file`** / **`PUSH_TRANSCRIPTS_SOURCE_DIR`**). See **[`scripts/sync-transcripts/README.md`](../scripts/sync-transcripts/README.md)**.

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
