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


| Situation                                                                                    | What to run                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Normal coding: JS/TS changes, fast refresh                                                   | Start Metro only (`expo start`; add `--clear` if the bundle acts stale).             |
| First time on this machine/device, or after changing **native** deps / Expo SDK / RN version | Install a fresh **development build** (local Xcode or EAS), then use Metro as usual. |
| Weird Metro errors, cache issues, or odd resolution after JS dependency edits                | `expo start --clear` (clears the Metro cache).                                       |




### Two servers on the Mac

The mobile app talks to **two** URLs on your laptop:


| Service          | Port     | Purpose                                                                       |
| ---------------- | -------- | ----------------------------------------------------------------------------- |
| **Metro** (Expo) | **8081** | JS bundle — enter this URL in the **dev client** (“development server”)       |
| **Next.js web**  | **3000** | APIs (`/api/lessons`, transcript, TTS, STT) — set in `EXPO_PUBLIC_WEB_ORIGIN` |


Do **not** point the dev client at `:3000`; Next.js returns HTML and you will see errors like *Expected MIME-Type … 'application/javascript' … but got 'text/html'*.

---



## iOS Simulator (same Mac)

1. Start the web app:
  ```bash
   cd apps/web && npm run dev
  ```
2. In `apps/mobile/.env.local`:
  ```env
   EXPO_PUBLIC_WEB_ORIGIN=http://localhost:3000
  ```
3. Start Metro and open the simulator:
  ```bash
   cd apps/mobile
   npx expo start --clear
  ```
   Press `i`, or open the dev client and tap `http://localhost:8081`.
4. Sign in (same account as web). The lesson list loads from `/api/lessons` on port 3000.

---



## Install the dev client on a physical iPhone

You need the native **AI Spanish (Development Build)** app on the phone once (rebuild when native deps / Expo SDK change).

### Option A — Local build with Xcode (recommended with USB cable)

1. Connect the iPhone (unlock, trust the Mac if prompted — see [Verify USB data cable](#verify-usb-data-cable) below).
2. From this directory:
  ```bash
   cd apps/mobile
   npx expo run:ios --device
  ```
   Select your **physical iPhone** when prompted.
3. Or open and run from Xcode (see [Open and run in Xcode](#open-and-run-in-xcode) below).



### Option B — EAS cloud build

From the monorepo root:

```bash
npm run build:mobile:ios
```

Or:

```bash
cd apps/mobile
eas login
eas build --profile development --platform ios
```

Install the artifact when the build finishes. Requires network and a valid Apple team for signing.

---



## Open and run in Xcode

Always use the **workspace** (CocoaPods), not the bare project -`AISpanish.xcodeproj!`:

```text
apps/mobile/ios/AISpanish.xcworkspace
```

1. Open `AISpanish.xcworkspace` in Xcode.
2. In the toolbar **scheme** menu, choose **AISpanish**.
3. In the **destination** menu, choose your **iPhone** (not a simulator, not “Any iOS Device”).
4. Select the **AISpanish** target → **Signing & Capabilities**:
  - Enable **Automatically manage signing**.
  - **Team:** your Apple ID (**Personal Team**). If the project shows another team ID you do not belong to, switch to your team here.
  - Bundle ID: `com.mikesmo.aispanish` (from `app.json`).
5. **Product → Clean Build Folder** (Shift+Cmd+K) if you hit stale native build errors.
6. **Product → Run** (▶) to build and install on the phone.

**First launch on device:** if iOS blocks the app, go to **Settings → General → VPN & Device Management → Developer App** → **Trust** your developer profile. This section appears only **after** a dev-signed app has been installed.

**On the phone (iOS 16+):** **Settings → Privacy & Security → Developer Mode → On** (restart if asked). Required for running development builds.

**Pods / native deps:** if builds fail with missing modules (e.g. `EXAV.modulemap` not found):

```bash
cd apps/mobile
npm install
cd ios
pod install
```

Then delete Xcode DerivedData for AISpanish if needed (**Xcode → Settings → Locations → Derived Data**), reopen the workspace, and Run again.

---



## Run on iPhone over Wi‑Fi

Phone and Mac must be on the **same Wi‑Fi network**.

1. **Web** (listen on all interfaces):
  ```bash
   cd apps/web
   npm run dev -- -H 0.0.0.0
  ```
2. **Mac LAN IP:**
  ```bash
   ipconfig getifaddr en0
  ```
   Example: `192.168.1.42`.
3. `apps/mobile/.env.local`**:**
  ```env
   EXPO_PUBLIC_WEB_ORIGIN=http://192.168.1.42:3000
   EXPO_PUBLIC_SUPABASE_URL=...
   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
  ```
4. **Metro** (use LAN so the phone can reach the bundler):
  ```bash
   cd apps/mobile
   npx expo start --clear --host lan
  ```
   Note the URL Metro prints (e.g. `http://192.168.1.42:8081`).
5. On the iPhone, open the **development build**:
  - Tap the listed development server if it appears, or
  - **Enter URL manually:** `http://192.168.1.42:8081` (your IP, port **8081**).
6. After changing `.env.local`, restart Metro with `--clear`.

**Verify from the Mac:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.1.42:3000/api/lessons
```

`401` without a Bearer token is expected (server is up).

---



## Run on iPhone over USB (no Wi‑Fi)

iOS has **no** Android-style `adb reverse`. To reach Metro and the web API over the cable, use **Mac Internet Sharing** to create a small network between Mac and iPhone.

### 1. USB network (Internet Sharing)

1. Connect the iPhone with a **data-capable** USB cable (see [Verify USB data cable](#verify-usb-data-cable)).
2. **System Settings → General → Sharing → Internet Sharing**
3. **Share your connection from:** any available source (e.g. Ethernet).
4. **To computers using:** enable **iPhone USB**
5. Turn **Internet Sharing** **On**

Find the Mac’s IP on the USB bridge (often `192.168.2.1` on `bridge100`):

```bash
ifconfig | grep -A 3 bridge100
ipconfig getifaddr bridge100
```

Use that address as `<MAC_IP>` below (example: `192.168.2.1`).

### 2. Start servers on the Mac

**Web:**

```bash
cd apps/web
npm run dev -- -H 0.0.0.0
```

**Metro:**

```bash
cd apps/mobile
npx expo start --clear --host lan
```



### 3. Environment

`apps/mobile/.env.local`**:**

```env
EXPO_PUBLIC_WEB_ORIGIN=http://<MAC_IP>:3000
```

Example: `http://192.168.2.1:3000`. Restart Metro after edits.

### 4. Connect the dev client on the phone

“Fetch development servers” often **does not** work without Wi‑Fi. Use **Enter URL manually**:

```text
http://<MAC_IP>:8081
```

Example: `http://192.168.2.1:8081` — port **8081**, not 3000.

Keep Internet Sharing enabled and the cable connected while developing.

---



## Start Metro (`expo start`)

After a development build is installed, day-to-day work is: run the bundler, open the dev client on the device/emulator, and iterate on JS.

Always run Expo **from** `apps/mobile` (this package owns the `expo` CLI). Running `npx expo` from unrelated folders such as `scripts/` will fail with `expo: command not found`.

**Clear Metro cache** (use when caches cause flaky bundling or strange resolution errors):

```bash
cd apps/mobile
npx expo start --clear
```

**Physical device (Wi‑Fi or USB):** prefer `--host lan`:

```bash
npx expo start --clear --host lan
```

**From the monorepo root:**

```bash
npm run start --workspace=@ai-spanish/mobile -- --clear
```

If port **8081** is already taken, stop the other Metro process (Ctrl+C in that terminal, or free the port) or accept another port when Expo prompts you (use that port in the dev client manual URL).

---



## Verify USB data cable

A **charge-only** cable will not support Xcode or Finder device sync.

**Quick test:** connect the iPhone (unlocked) and open **Finder → Locations → [your iPhone]**.

If Finder shows **model name**, **storage**, **battery %**, and tabs (General, Photos, Info, …), the cable and port carry **Apple’s USB data protocol**. You do **not** need a separate “data mode” indicator.

If the phone only charges and never appears in Finder or **Xcode → Window → Devices and Simulators**, try another cable (prefer the cable that came with the iPhone or a known sync cable) and another USB port on the Mac.

**Trust This Computer:** iOS prompts the first time you connect to a Mac. If you already trusted this Mac, the prompt will not appear again — that is normal if Finder shows full device details.

---



## USB debugging and device connection (Android)

**Android over USB uses ADB** (Android Debug Bridge). Install [Android platform-tools](https://developer.android.com/tools/releases/platform-tools) so `adb` is on your `PATH`.

1. On the phone: **Settings → Developer options** → enable **USB debugging**.
2. Connect USB and approve **Allow USB debugging?** when prompted.
3. Confirm the machine sees the device:
  ```bash
   adb devices
  ```
   The device should appear as `device` (not `unauthorized`).
4. If a **physical Android** cannot reach Metro on USB, forward the bundler port (default **8081**; match whatever Metro prints):
  ```bash
   adb reverse tcp:8081 tcp:8081
  ```

Then start Metro and open the development build on the device.

---



## Environment variables

Set these in `apps/mobile/.env.local` (not in `apps/web`).


| Variable                        | Description                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_WEB_ORIGIN`        | Base URL of the Next.js app (see below). The web server must have `DEEPGRAM_API_KEY` set for speech features. |
| `EXPO_PUBLIC_SUPABASE_URL`      | Same as the web app (`NEXT_PUBLIC_SUPABASE_URL`). Required so you can sign in and call authenticated APIs.    |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Same as the web app (`NEXT_PUBLIC_SUPABASE_ANON_KEY`).                                                        |


Sign in with the **same email/password** as on the web app before opening a lesson; transcripts and UX audio load via Bearer-authenticated requests.

### Setting `EXPO_PUBLIC_WEB_ORIGIN`

The mobile app calls the web app for lesson catalog (`/api/lessons`), transcript (`/api/transcript`), package audio, Deepgram keys (`/api/authenticate`), and TTS (`/api/text-to-speech`).


| Environment                   | `EXPO_PUBLIC_WEB_ORIGIN`                                            |
| ----------------------------- | ------------------------------------------------------------------- |
| iOS Simulator (same Mac)      | `http://localhost:3000`                                             |
| Android Emulator              | `http://10.0.2.2:3000`                                              |
| Physical iPhone (Wi‑Fi)       | `http://<mac-lan-ip>:3000` from `ipconfig getifaddr en0`            |
| Physical iPhone (USB sharing) | `http://<mac-usb-bridge-ip>:3000` (often `http://192.168.2.1:3000`) |


For physical devices, start the web app with:

```bash
cd apps/web
npm run dev -- -H 0.0.0.0
```

After changing `.env.local`, restart the Expo dev server (`npx expo start --clear`).

---


## Dev debug logging from a physical device

Metro's console is fine for the simulator, but when you need structured runtime logs from a **physical phone** (e.g. an AI debug session whose ingest server listens on `127.0.0.1:7558` on the Mac), the phone cannot reach `localhost` on your machine. Two dev-only pieces solve this; both are no-ops in production.

1. **Shared logger** — `agentDebugLog()` from `@ai-spanish/logic`. Call it anywhere in `packages/*` or `apps/mobile`:

   ```ts
   import { agentDebugLog } from '@ai-spanish/logic';
   agentDebugLog({ location: 'stt/index.native.ts:ws-open', message: 'WS opened', data: { ms } });
   ```

   It only sends when `EXPO_PUBLIC_AGENT_DEBUG_LOG=1` **and** the bundle is a dev build. Never log tokens, keys, or PII.

2. **Collectors the phone can reach**
   - `POST ${EXPO_PUBLIC_WEB_ORIGIN}/api/agent-debug-log` (Next.js dev route, auth-exempt in dev). Appends NDJSON to `AGENT_DEBUG_LOG_PATH` (default `<repo>/.cursor/agent-debug.log`) and forwards to `AGENT_DEBUG_INGEST_URL` if set in `apps/web/.env.local`.
   - **LAN relay** — `npm run debug:relay` (root) listens on `0.0.0.0:17558` and pipes to `127.0.0.1:7558`. Point the phone at it with `EXPO_PUBLIC_AGENT_DEBUG_INGEST_URL=http://<mac-lan-ip>:17558/ingest/<session>`. Ports are overridable via `RELAY_LISTEN_PORT` / `RELAY_TARGET_PORT`.


| Variable (`apps/mobile/.env.local`)   | Purpose                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `EXPO_PUBLIC_AGENT_DEBUG_LOG=1`       | Turns the logger on (dev builds only).                                  |
| `EXPO_PUBLIC_AGENT_DEBUG_SESSION_ID`  | Optional; sent as `sessionId` + `X-Debug-Session-Id`.                   |
| `EXPO_PUBLIC_AGENT_DEBUG_INGEST_URL`  | Optional; full ingest URL reachable from the phone (usually the relay). |


Restart Metro after changing these (`npx expo start --clear`). Remove `agentDebugLog` call sites before merging; the helper itself is safe to leave in place.

---


## Troubleshooting (iPhone)


| Symptom                                       | What to try                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading lessons…** forever                  | Web not running; wrong `EXPO_PUBLIC_WEB_ORIGIN`; restart Metro after env change. Simulator: use `localhost:3000`. Device: use Mac IP + `dev -- -H 0.0.0.0`. |
| **MIME-Type … text/html**                     | Dev client URL must be Metro on **:8081**, not Next.js **:3000**.                                                                                           |
| **Device unavailable / developer disk image** | Update **Xcode** to match the phone’s iOS version; wait in **Devices and Simulators** for “Preparing debugger support…”.                                    |
| **Failed to acquire assertion**               | Enable **Developer Mode** on the phone; unlock device; replug USB; restart phone/Mac; ensure Xcode supports your iOS version.                               |
| **Signing / team errors**                     | In Xcode **Signing & Capabilities**, pick **your** Personal Team; clean build folder.                                                                       |
| `EXAV.modulemap` **not found**                | `npm install` → `cd ios && pod install` → clean DerivedData → rebuild. Open `.xcworkspace`.                                                                 |
| Dev client cannot find server (no Wi‑Fi)      | Use **Enter URL manually** with `http://<MAC_IP>:8081` and USB Internet Sharing (see above).                                                                |
| Mac firewall                                  | Allow **Node** / Terminal incoming connections for ports **8081** and **3000**.                                                                             |


**Xcode device window:** **Window → Devices and Simulators → Devices** — the phone should appear with iOS version. Warnings here explain many install/debug failures.

**Safari debugging (optional):** **Safari → Develop → [your iPhone]** for JS console/network after enabling **Web Inspector** on the device.

---



## EAS development build (reference)

Build an installable **development** binary (`eas.json` profile `development` uses `developmentClient: true`). Use when you cannot use local Xcode or need a cloud build.

**Android** (from monorepo root):

```bash
npm run build:mobile
```

**iOS:**

```bash
npm run build:mobile:ios
```

Requires [EAS](https://expo.dev) (`eas login`). Apple signing must use a team your account belongs to.