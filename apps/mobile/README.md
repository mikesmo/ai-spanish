# AI Spanish — Mobile (Expo)

## Setup

1. Install dependencies from the monorepo root:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the values:
   ```bash
   cp .env.example .env.local
   ```

3. Start the Expo dev server:
   ```bash
   npm run start --workspace=@ai-spanish/mobile
   ```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_WEB_ORIGIN` | Base URL of the Next.js app (see below). The web server must have `DEEPGRAM_API_KEY` set for speech features. |

## Setting EXPO_PUBLIC_WEB_ORIGIN

The mobile app calls the web app for the lesson transcript (`/api/transcript`), short-lived Deepgram keys for speech-to-text (`/api/authenticate`), and TTS audio (`/api/text-to-speech`). `localhost` does **not** work on physical devices or the Android emulator — you must use your machine's LAN IP address (or your deployed site URL in production).

**Find your LAN IP:**
```bash
ipconfig getifaddr en0
```

Then set `EXPO_PUBLIC_WEB_ORIGIN` in your `.env.local` to that address, e.g.:
```
EXPO_PUBLIC_WEB_ORIGIN=http://192.168.1.42:3000
```

**Platform notes:**

| Environment | Value to use |
|-------------|-------------|
| iOS Simulator (same Mac) | `http://localhost:3000` works |
| Android Emulator | `http://10.0.2.2:3000` |
| Physical device (iOS or Android) | `http://<your-mac-lan-ip>:3000` |

**Make sure the Next.js dev server is listening on all interfaces**, not just localhost. Start it with:
```bash
npm run dev -- -H 0.0.0.0
```

After changing `.env.local`, restart the Expo dev server so it picks up the new value.
