# AI Spanish

A Spanish language learning app that uses voice recognition and AI-powered text-to-speech to help you practice speaking Spanish phrases.

## Features

- **Listen & Repeat** — hear a Spanish phrase spoken aloud, then say it back
- **Voice recognition** — your speech is transcribed in real time via Deepgram
- **Instant feedback** — see exactly which words you got right, wrong, or missed
- **Adjustable playback speed** — replay phrases at normal or slow speed
- **Cross-platform** — runs as a Next.js web app and an Expo mobile app (iOS & Android)

## Project Structure

```
apps/
  web/        Next.js web app
  mobile/     Expo mobile app (iOS & Android)
packages/
  logic/      Shared business logic, state machine, phrase data, word diff
  ai/ Deepgram TTS and STT adapters (web and native)
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm 10+
- An [Expo account](https://expo.dev) (for mobile builds)
- A [Deepgram API key](https://console.deepgram.com)

### Install dependencies

From the monorepo root:

```bash
npm install
```

### Environment variables

Copy the example files and fill in the values:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
```

- **`apps/web/.env.local`** — set `DEEPGRAM_API_KEY` (get one at [console.deepgram.com](https://console.deepgram.com)). The web app uses it server-side for TTS, minting short-lived STT keys, and (in development) the authenticate endpoint.
- **`apps/mobile/.env.local`** — set `EXPO_PUBLIC_WEB_ORIGIN` to your Next.js base URL (LAN IP or production URL). The mobile app does **not** embed a Deepgram key; it uses the web APIs above for transcript, STT auth, and TTS.

---

## Running the apps

### Web app

From the monorepo root:
```bash
npm run dev:web
```

Or from the app directory:
```bash
cd apps/web && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

### Mobile app (Expo)

This app uses an **Expo development build** (not Expo Go). Full setup—simulator, iPhone over Wi‑Fi, iPhone over USB, Xcode, env vars, and troubleshooting—is in **[apps/mobile/README.md](apps/mobile/README.md)**.

**Quick start (iOS Simulator):**

```bash
cd apps/web && npm run dev          # terminal 1
cd apps/mobile && cp .env.example .env.local   # set EXPO_PUBLIC_* (see mobile README)
cd apps/mobile && npx expo start --clear      # terminal 2; press i
```

**Install the native shell on a physical iPhone:** `cd apps/mobile && npx expo run:ios --device`, or open `apps/mobile/ios/AISpanish.xcworkspace` in Xcode and Run. Cloud alternative: `npm run build:mobile:ios`.

Then start Metro from the monorepo root:

```bash
npm run dev:mobile
```

On a **physical device**, connect the dev client to Metro (usually `http://<your-mac-ip>:8081`) and set `EXPO_PUBLIC_WEB_ORIGIN` to the web app on port **3000**—see the mobile README for Wi‑Fi vs USB cable.

> **Note:** Audio playback (`expo-av`) requires the development build above. It will not work in standard [Expo Go](https://expo.dev/go).

## Spaced repetition (SRS)

Cross-session scheduling is **lesson-based**, not wall-clock. Each `PhraseProgress` stores `dueOnLessonSessionIndex`: the phrase is eligible for the “scheduled review” slice of a built deck when the host’s **`completedLessonCount`** (number of fully finished lesson runs) is at least that index. After each scored attempt or reveal, the reducer sets that index from the current count plus a banded offset (e.g. next lesson while learning, two lessons ahead while stabilizing, growing spacing in the mastered band).

The web lesson host bumps `completedLessonCount` when the session queue drains. For real persistence, store that counter (and phrase progress) in local storage or a backend between visits; remounting the lesson UI without restoring it resets the counter to zero.

### Local build (requires Android Studio / Xcode)

```bash
cd apps/mobile
npx expo run:android   # requires Android Studio + emulator or connected device
npx expo run:ios       # requires Xcode + simulator or connected device
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev:web` | Start the Next.js web app |
| `npm run dev:mobile` | Start the Expo dev server |
| `npm run build:mobile` | EAS build — Android development client |
| `npm run build:mobile:ios` | EAS build — iOS development client |
| `npm run build` | Production build (all apps via Turborepo) |
| `npm run typecheck` | TypeScript check (all packages) |
