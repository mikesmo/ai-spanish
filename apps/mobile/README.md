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

3. Continue with **Development workflow** below: build or refresh a **native development client** when needed, then use **Metro** (`expo start`) for day-to-day work.

## Development workflow

This app depends on **Expo Dev Client** (`expo-dev-client`) and **native modules** (for example `react-native-deepgram`). **Expo Go** cannot load that native stack—you install a **development build** on a device or emulator, then connect it to Metro on your machine.

### When to use what

| Situation | What to run |
|-----------|----------------|
| Normal coding: JS/TS changes, fast refresh | Start Metro only (`expo start`; add `--clear` if the bundle acts stale). |
| First time on this machine/device, or after changing **native** deps / Expo SDK / RN version | Create a new **EAS development build** and install it, then use Metro as usual. |
| Weird Metro errors, cache issues, or odd resolution after JS dependency edits | `expo start --clear` (clears the Metro cache). |

### EAS development build (install the native app)

Build an installable **development** binary (`eas.json` profile `development` uses `developmentClient: true`). Use this when you need a fresh native shell—not for every edit.

**Android** (from monorepo root):

```bash
npm run build:mobile
```

Or from this directory:

```bash
cd apps/mobile
eas build --profile development --platform android
```

**iOS** (same profile, different platform—from root):

```bash
npm run build:mobile:ios
```

Requires [EAS](https://expo.dev) (`npm install -g eas-cli` or use `npx eas-cli`), project logged in (`eas login`), and typically network access so EAS can run the build. When the build finishes, install the artifact on your emulator or device (EAS shows download / install steps).

### Start Metro (`expo start`)

After a development build is installed, day-to-day work is: run the bundler, open the dev client on the device/emulator, and iterate on JS.

Always run Expo **from `apps/mobile`** (this package owns the `expo` CLI). Running `npx expo` from unrelated folders such as `scripts/` will fail with `expo: command not found`.

**Clear Metro cache** (use when caches cause flaky bundling or strange resolution errors):

```bash
cd apps/mobile
npx expo start --clear
```

**Same thing from the monorepo root:**

```bash
npm run start --workspace=@ai-spanish/mobile -- --clear
```

For routine sessions you can omit `--clear`:

```bash
npm run start --workspace=@ai-spanish/mobile
```

If port **8081** is already taken, stop the other Metro process (Ctrl+C in that terminal, or free the port) or accept another port when Expo prompts you.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_WEB_ORIGIN` | Base URL of the Next.js app (see below). The web server must have `DEEPGRAM_API_KEY` set for speech features. |
| `EXPO_PUBLIC_SUPABASE_URL` | Same as the web app (`NEXT_PUBLIC_SUPABASE_URL`). Required so you can sign in and call authenticated APIs (`/api/transcript`, `/api/package-audio`, etc.). |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Same as the web app (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). |

Sign in with the **same email/password** as on the web app before opening a lesson; transcripts and UX audio load via Bearer-authenticated requests.

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
|-------------|--------------|
| iOS Simulator (same Mac) | `http://localhost:3000` works |
| Android Emulator | `http://10.0.2.2:3000` |
| Physical device (iOS or Android) | `http://<your-mac-lan-ip>:3000` |

**Make sure the Next.js dev server is listening on all interfaces**, not just localhost. Start it with:

```bash
npm run dev -- -H 0.0.0.0
```

After changing `.env.local`, restart the Expo dev server so it picks up the new value.
