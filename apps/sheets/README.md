# AI Spanish — Google Sheets Apps Script

This folder is the Apps Script bound to your spreadsheet (`Code.js`, `sidebar.html`, `appsscript.json`). Manage it with **[clasp](https://github.com/google/clasp)** (CLI for Apps Script).

`README.md` is listed in [`.claspignore`](./.claspignore), so these docs are not uploaded to Apps Script—only `.js`/`.html`/manifest files are pushed.

## One-time setup

1. Install the CLI (pick one):

   ```bash
   npm install -g @google/clasp
   ```

   Or run commands without installing globally:

   ```bash
   npx @google/clasp <command>
   ```

2. Sign in with the Google account that owns this script / spreadsheet:

   ```bash
   clasp login
   ```

   To switch accounts later: `clasp logout` then `clasp login` again.

## Working directory

Run clasp from **this folder** (`apps/sheets`), where [`.clasp.json`](./.clasp.json) lives:

```bash
cd apps/sheets
```

(From the monorepo root: `cd apps/sheets` then use the commands below.)

## Commands you will use most

| Command | What it does |
|--------|----------------|
| `clasp push` | Upload local files (e.g. `Code.js`, `sidebar.html`, `appsscript.json`) to the Apps Script project. **Run this after editing code.** |
| `clasp pull` | Download the latest script from the server into this folder (use after editing in script.google.com to sync back). |
| `clasp status` | List which local files clasp will push (`--json` optional). |
| `clasp open-script` | Open the Apps Script editor for this project in your browser. (`clasp open-container` opens the spreadsheet’s container when relevant.) |

## Development loop

Push every time you change source:

```bash
clasp push
```

Optional: watch files and push on save:

```bash
clasp push --watch
```

## Versions and deployments (optional)

For snapshotting or web-app deployments, clasp can version the project—not required for sidebar-only edits:

```bash
clasp version "Short description"
clasp deployments   # shorthand for list-deployments; shows deployment IDs
```

Use `clasp deploy` to create a deployment when you expose a Web App endpoint (not needed for this spreadsheet sidebar workflow).

## Troubleshooting

- **Permission / auth errors**: `clasp login` again; ensure `.clasp.json`’s script matches your project (see [Apps Script dashboard](https://script.google.com/)).
- **Push fails or wrong project**: Confirm you ran commands from `apps/sheets`, not the repo root.
- **`appsscript.json` oauthScopes**: After changing scopes, reopen the spreadsheet and authorize when prompted after the next menu run.

## Config

- **Script properties** (Apps Script editor → Project settings → Script properties): required for the sidebar “Load lesson from web” flow.
  - **`WEB_ORIGIN`** — deployed web app origin, e.g. `https://ai-spanish-web.vercel.app` (no trailing slash). Used to call `GET /api/transcript?lesson=1`.
  - **`SUPABASE_URL`** — same value as the web app’s `NEXT_PUBLIC_SUPABASE_URL` (e.g. `https://<project-ref>.supabase.co`).
  - **`SUPABASE_ANON_KEY`** — same value as `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Used only in server-side `UrlFetchApp` calls, not in the sidebar HTML.
- **Phrase audio (sidebar)** — After **Sign in & load lesson**, the sidebar keeps Supabase **access** and **refresh** tokens plus a `phraseDirectory` (name → index) in memory. **Play** calls `GET /api/audio` with the access token. Tokens are refreshed automatically shortly before access-token expiry; if refresh fails, you are signed out and must sign in again. **Log out** clears tokens and the phrase directory. Closing the sidebar clears memory; sign in again next time.
- **Spreadsheet association** — clasp updates the script tied to `.clasp.json`; the script must stay bound or linked as you already set up in Sheets.
