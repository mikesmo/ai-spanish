# TTS batch (`@ai-spanish/tts-batch`)

Batch-generates MP3 clips from the bilingual transcript using [Deepgram](https://deepgram.com/) text-to-speech (same models as `@ai-spanish/ai`), writes a local manifest, and optionally uploads audio plus `manifest.json` to Amazon S3.

Run commands from the **monorepo root** so default paths resolve (`packages/logic/assets/transcript.json`, `./output`).

## Setup

1. Install dependencies at the repo root: `npm install`
2. Copy `.env.example` to `.env` in this directory and fill in values
3. Invoke via the root script (recommended):

   ```bash
   npm run tts:batch -- --help
   ```

   Or from this package:

   ```bash
   npm run start --workspace=@ai-spanish/tts-batch -- --help
   ```

## Environment variables

| Variable | When |
|----------|------|
| `DEEPGRAM_API_KEY` | Required for any run that calls TTS (omit only with `--upload-only`) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Required when uploading to S3 (not needed for `--local-only`) |
| `AWS_REGION` | Optional; defaults to `us-east-1` |
| `S3_BUCKET_NAME` | Bucket **name only** (e.g. `my-bucket`). Do not use `s3://...` or paths |
| `AUDIO_CONTENT_PREFIX` | Single path segment for S3 keys; default in code: `audio-content` |
| `S3_LESSON` | Optional lesson folder under the prefix (overridden by `--lesson`) |

Secrets belong in `.env` (gitignored). Never commit real keys.

## CLI options

| Flag | Description |
|------|-------------|
| `--input`, `-i` | Transcript JSON (default: `packages/logic/assets/transcript.json` from cwd) |
| `--out`, `-o` | Output directory (default: `./output`) |
| `--bucket`, `-b` | S3 bucket name (default: `S3_BUCKET_NAME`) |
| `--lesson` | Optional segment under `AUDIO_CONTENT_PREFIX` (overrides `S3_LESSON`) |
| `--force` | Regenerate all clips; ignore hash cache |
| `--local-only` | Write `output/` only; no S3, no AWS keys required |
| `--upload-only` | Upload existing `output/` to S3; no Deepgram calls |
| `--help`, `-h` | Show help |

## Modes

- **Default:** synthesize missing/changed clips (with cache), write `manifest.json`, then upload to S3 if credentials and bucket are set.
- **`--local-only`:** synthesize only; manifest omits `s3Key` until a later upload with the same layout config.
- **`--upload-only`:** read `output/manifest.json`, recompute S3 keys from current `AUDIO_CONTENT_PREFIX` / `--lesson` / `S3_LESSON`, upload MP3s and manifest. Incompatible with `--local-only` and `--force`.

## Local output

```
output/
  audio/
    {phraseIndex}-{en|es}-{field}.mp3
  manifest.json
  .cache/
    hashes.json
```

Transcript rows are flattened to jobs such as `{i}-en-intro`, `{i}-en-question`, `{i}-es-question` (empty strings skipped).

## S3 object keys

Prefix defaults to `audio-content` if `AUDIO_CONTENT_PREFIX` is unset.

With `AUDIO_CONTENT_PREFIX=audio-content` and `--lesson lesson1`:

- Manifest: `audio-content/lesson1/manifest.json`
- Audio: `audio-content/lesson1/audio/{jobId}.mp3`

With no lesson:

- `audio-content/manifest.json`
- `audio-content/audio/{jobId}.mp3`

## Typecheck

```bash
npm run typecheck --workspace=@ai-spanish/tts-batch
```
