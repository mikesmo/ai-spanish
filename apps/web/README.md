# Spanish Phrases App

A simple Next.js application that reads Spanish phrases from a JSON file and displays them on the homepage.

## Features

- Next.js 15 with App Router
- Supabase email/password authentication (session cookies + middleware)
- Server-side JSON file reading
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

- `public/lesson1.json` - JSON file containing Spanish phrases and their English translations
- `src/app/page.tsx` - Main homepage component that reads and displays the phrases

## Modifying the Content

To change the displayed phrases, edit the `public/lesson1.json` file (or add lessons under `public/lesson*.json`). The app will display the updated content. Each phrase is an object with at least `name` (stable slug), `index` (0-based phrase order in the lesson; used as the TTS / audio filename prefix), `English`, and `Spanish`. Optional `type` may be `"new"` or `"combination"`.

Example shape (abbreviated):

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
