# Supabase (database migrations)

Lesson transcripts and other schema changes live in **`migrations/`**. Apply them with the [Supabase CLI](https://supabase.com/docs/guides/cli):

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

Do **not** hand-edit production schema in the dashboard only — keep DDL and seed data in versioned SQL here.
