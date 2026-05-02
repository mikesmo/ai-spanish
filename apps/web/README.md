# Spanish Phrases App

A simple Next.js application that loads Spanish lesson phrases from Supabase and displays them on the homepage.

## Features

- Next.js 15 with App Router
- Supabase email/password authentication (session cookies + middleware)
- Server-side phrase decks loaded from Supabase (`lesson_transcripts`), exposed via authenticated `/api/transcript`
- Responsive design with Tailwind CSS
- Spanish-English phrase pairs
- Speech recognition for practice
- Text-to-speech pronunciation with multiple providers (Deepgram and Google)
- Interactive flashcard interface

## Getting Started

1. Create a `.env.local` file in this directory (`apps/web`) with your keys:

```env
# Required: Supabase (Authentication → API in the Supabase dashboard)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here

# Required for Deepgram TTS / STT (see below for local STT shortcut)
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Optional: For Google TTS (point to your credentials file)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/google_credentials.json

# Optional: For Murf TTS
MURF_API_KEY=your_murf_api_key_here
```

2. **Supabase project (dashboard)**

   - **Authentication → Providers**: enable **Email** (email + password).
   - **Authentication → URL configuration**:
     - **Site URL**: your production origin (e.g. `https://your-app.vercel.app`).
     - **Redirect URLs**: include `http://localhost:3000/auth/callback`, your production `https://.../auth/callback`, and any Vercel preview URLs you use.
   - **Email confirmations**: optional; if enabled, sign-up sends a confirmation link that returns via `/auth/callback`.

3. **Vercel**: add the same `NEXT_PUBLIC_SUPABASE_*` variables (and other secrets) to the Vercel project for Production and Preview. Do not put the Supabase **service role** key in `NEXT_PUBLIC_*` variables.

4. For Google Cloud TTS (optional):

   - Create a service account in Google Cloud with Text-to-Speech API access
   - Download the JSON key file and store it securely
   - Point to it in the environment variable above

5. Run the development server from the monorepo root:

```bash
npm run dev --workspace=@ai-spanish/web
```

6. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Local speech shortcut

If `DEEPGRAM_ENV=development` is set, `GET /api/authenticate` skips Supabase and returns `DEEPGRAM_API_KEY` directly (see [src/app/api/authenticate/route.ts](src/app/api/authenticate/route.ts)). Middleware also allows that route without a session in development only. Do **not** set `DEEPGRAM_ENV=development` in production.

## Project Structure

- [`supabase/migrations/`](../../supabase/migrations/) — database migrations for `lesson_transcripts` (apply with Supabase CLI; see [`supabase/README.md`](../../supabase/README.md))
- `src/app/page.tsx` - Main homepage component that reads and displays the phrases

## Modifying lesson content

Lesson phrases live in **Supabase** (`public.lesson_transcripts`, column `phrases` JSON). `lesson_id` is a **positive decimal string without leading zeros** (`1`, `2`, `12`, …). Authenticated clients load them through **`GET /api/transcript?lesson=1`** (see [`src/app/api/transcript/route.ts`](src/app/api/transcript/route.ts)).

To update content:

- Call **`PUT` or `PATCH /api/transcript?lesson=<id>`** with a JSON body matching **`TranscriptResponse`** (same shape as `GET`). Requires **`SUPABASE_SERVICE_ROLE_KEY`** on the server alongside **`NEXT_PUBLIC_SUPABASE_URL`**. **`PUT`** upserts: existing ids update in place; **new ids insert a new row** once migrations allowing extended ids have been applied (see [`supabase/migrations/`](../../supabase/migrations/)).
- **CLI (bulk from disk):** From the monorepo root, place files at **`input/lessons/<id>.json`** (e.g. `1.json`, `3.json`). Put **`NEXT_PUBLIC_SUPABASE_URL`** and **`SUPABASE_SERVICE_ROLE_KEY`** in repo-root **`.env.scripts`** (see **[`.env.scripts.example`](../../.env.scripts.example)** and [`scripts/sync-transcripts/README.md`](../../scripts/sync-transcripts/README.md)), then run **`npm run push:transcripts`**. The CLI writes **`lesson_transcripts`** directly via Supabase (no Next.js server required). New lessons can exist in the DB before they appear in the [`lessonCatalog`](../../packages/logic/src/lessonCatalog.ts)—add a **`lessons`** entry when the app shell should list them.

- Or edit `phrases` JSON in the Supabase Table Editor for quick fixes (DDL and policies remain in [`supabase/migrations/`](../../supabase/migrations/)).

Each phrase object uses at least `name` (stable slug), `index` (0-based order; used as the TTS / audio filename prefix), `English`, and `Spanish`. Optional `type` may be `"new"` or `"composite"`.

### Required env for transcripts

Add to `.env.local` (see [.env.example](.env.example)):

```env
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

The service role key is **server-only**; never use a `NEXT_PUBLIC_*` variable for it.

### Example phrase shape

Abbreviated:

```json
[
  {
    "name": "perdon",
    "index": 0,
    "type": "new",
    "English": {
      "first-intro": "…",
      "second-intro": "…",
      "question": "Excuse me"
    },
    "Spanish": {
      "grammar": "",
      "answer": "Perdón",
      "words": [{ "word": "perdón", "type": "noun", "weight": 2.5 }]
    }
  }
]
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

## Deploy on Vercel

Deploy this app with the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme). Configure Supabase redirect URLs for your production and preview domains.
