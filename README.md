# AI Spanish

A Spanish language learning app that uses voice recognition and AI-powered text-to-speech to help you practice speaking Spanish phrases.

## Features

- **Listen & Repeat** — hear a Spanish phrase spoken aloud, then say it back
- **Voice recognition** — your speech is transcribed in real time via Deepgram
- **Instant feedback** — see exactly which words you got right, wrong, or missed
- **Adjustable playback speed** — replay phrases at normal or slow speed
- **Cross-platform** — runs as a Next.js web app and an Expo mobile app (iOS & Android)

## Monorepo Structure

```
apps/
  web/        Next.js web app
  mobile/     Expo mobile app (iOS & Android)
packages/
  logic/      Shared business logic, state machine, phrase data, word diff
  claude-api/ Deepgram TTS and STT adapters (web and native)
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm 10+
- An [Expo account](https://expo.dev) (for mobile builds)
- A [Deepgram API key](https://console.deepgram.com)

### Install dependencies

```bash
npm install
```

### Environment variables

**Web** — create `apps/web/.env.local`:
```
DEEPGRAM_API_KEY=your_key_here
```

**Mobile** — create `apps/mobile/.env.local`:
```
EXPO_PUBLIC_DEEPGRAM_API_KEY=your_key_here
```

### Run the web app

```bash
npm run dev:web
```

Open [http://localhost:3000](http://localhost:3000).

### Run the mobile app

Start the Expo dev server:

```bash
cd apps/mobile && npx expo start
```

Scan the QR code with [Expo Go](https://expo.dev/go) on your phone, or press `i` for iOS simulator.

> **Note:** Audio playback (`expo-av`) requires a development build — it will not work in Expo Go. Build a development client with:
> ```bash
> npm run build:mobile      # Android
> npm run build:mobile:ios  # iOS
> ```

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev:web` | Start the Next.js web app |
| `npm run dev:mobile` | Start the Expo dev server |
| `npm run build:mobile` | EAS build — Android development client |
| `npm run build:mobile:ios` | EAS build — iOS development client |
| `npm run build` | Production build (all apps via Turborepo) |
| `npm run typecheck` | TypeScript check (all packages) |
