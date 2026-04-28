# Spanish Phrases App

A simple Next.js application that reads Spanish phrases from a JSON file and displays them on the homepage.

## Features

- Next.js 14 with App Router
- Server-side JSON file reading
- Responsive design with Tailwind CSS
- Spanish-English phrase pairs
- Speech recognition for practice
- Text-to-speech pronunciation with multiple providers (Deepgram and Google)
- Interactive flashcard interface

## Getting Started

1. Create a `.env.local` file in the root directory with your API keys:

```env
# Required for Deepgram TTS
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Optional: For Google TTS (point to your credentials file)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/google_credentials.json

# Optional: For Murf TTS
MURF_API_KEY=your_murf_api_key_here
```

2. For Google Cloud TTS (optional):
   - Create a service account in Google Cloud with Text-to-Speech API access
   - Download the JSON key file and store it securely
   - Point to it in the environment variable above

3. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

4. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

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

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.