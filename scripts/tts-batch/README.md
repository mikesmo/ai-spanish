# TTS batch (`@ai-spanish/tts-batch`)

Batch-generates MP3 clips from the bilingual transcript using [Deepgram](https://deepgram.com/) text-to-speech (same models as `@ai-spanish/ai`), writes a local manifest, and optionally uploads audio plus `manifest.json` to Amazon S3.

Run commands from the **monorepo root** so default paths resolve (`apps/web/public/lesson1.json`, `./output`).

## System requirements

- **Node.js** (see repo root for version)
- **ffmpeg** (with ffprobe) — required for audio post-processing (enabled by default). Install on macOS:

  ```bash
  brew install ffmpeg
  ```

  If you pass `--no-audio-pos`, ffmpeg/ffprobe are not needed.

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
| `DEEPGRAM_API_KEY` | Required for TTS and for `--verify-stt` (omit with `--upload-only` or for `--verify-loudness` alone) |
| `TTS_VERIFY_LOUDNESS_MIN_MAX_DB` | Optional; for `--verify-loudness` / combined STT check: **max** (peak) volume in dB must be **≥** this value (default **-30**; louder peaks are less negative) |
| `TTS_VERIFY_LOUDNESS_MIN_MEAN_DB` | Optional; **mean** volume in dB must be **≥** this value (default **-40**; louder means are less negative) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Required when uploading to S3 (not needed for `--local-only`) |
| `AWS_REGION` | Optional; defaults to `us-east-1` |
| `S3_BUCKET_NAME` | Bucket **name only** (e.g. `my-bucket`). Do not use `s3://...` or paths |
| `AUDIO_CONTENT_PREFIX` | Single path segment for S3 keys; default in code: `audio-content` |
| `S3_LESSON` | Optional lesson folder under the prefix (overridden by `--lesson`) |
| `TRANSCRIPT_INPUT` | Path to transcript JSON (relative to cwd or absolute); default: `apps/web/public/lesson1.json`. Overridden by `--input` |

Secrets belong in `.env` (gitignored). Never commit real keys.

## CLI options

| Flag | Description |
|------|-------------|
| `--input`, `-i` | Transcript JSON (default: `TRANSCRIPT_INPUT` env, then `apps/web/public/lesson1.json`) |
| `--out`, `-o` | Output directory (default: `./output`) |
| `--bucket`, `-b` | S3 bucket name (default: `S3_BUCKET_NAME`) |
| `--lesson` | Optional segment under `AUDIO_CONTENT_PREFIX` (overrides `S3_LESSON`) |
| `--force` | Regenerate all clips; ignore hash cache |
| `--local-only` | Write `output/` only; no S3, no AWS keys required |
| `--upload-only` | Upload existing `output/` to S3; no Deepgram calls |
| `--only-phrase` | 0-based phrase index (same as the job id prefix, e.g. `11` → all `11-en-…` and `11-es-…` clips). Regenerates only those files, merges new rows into the existing `manifest.json` and hash cache; other clips are left unchanged. **Requires** a previous full `tts:batch` so every other id already exists in the manifest. Incompatible with `--verify-stt` and `--upload-only`. |
| `--verify-stt` | Runs **`--verify-loudness` first**, then Deepgram STT on each `manifest.json` MP3. STT: optional `keywords` from expected `text` (tokenize via `tokenizeForDeepgramKeywords` in `@ai-spanish/logic`, `word:1` if **3+** tokens). **strict** normalized text compare. Exit 1 if loudness **or** STT fails. Requires `DEEPGRAM_API_KEY` and **ffmpeg** on `PATH` |
| `--verify-loudness` | **ffmpeg** `volumedetect`: `max_volume` must be **≥** `TTS_VERIFY_LOUDNESS_MIN_MAX_DB` and `mean_volume` **≥** `TTS_VERIFY_LOUDNESS_MIN_MEAN_DB`. Use alone (no API key) or with `--verify-stt` (STT run already includes loudness). Incompatible with `--upload-only` and `--only-phrase` |
| `--no-audio-pos` | Skip ffmpeg post-processing; write raw Deepgram output (no ffmpeg required) |
| `--help`, `-h` | Show help |

## Modes

- **Default:** synthesize missing/changed clips (with cache), apply audio post-processing, write `manifest.json`, then upload to S3 if credentials and bucket are set.
- **`--local-only`:** synthesize only; manifest omits `s3Key` until a later upload with the same layout config.
- **`--upload-only`:** read `output/manifest.json`, recompute S3 keys from current `AUDIO_CONTENT_PREFIX` / `--lesson` / `S3_LESSON`, upload MP3s and manifest. Incompatible with `--local-only` and `--force`.
- **`--only-phrase`:** re-synthesize all jobs whose id starts with `{index}-` for the current transcript, then rewrite `manifest.json` with a **merged** list: updated entries for that phrase, unchanged `ManifestEntry` objects for all other job ids (read from the existing on-disk manifest). Fails if `manifest.json` is missing an id required by the current `buildTtsJobs` output—run a full batch first. The selected phrase is always fully regenerated (cache is ignored for those ids). Incompatible with `--verify-stt` and `--upload-only`.
- **`--verify-loudness`:** `ffmpeg` analyzes each `localFile` (peak and mean; see `TTS_VERIFY_LOUDNESS_MIN_MAX_DB` and `TTS_VERIFY_LOUDNESS_MIN_MEAN_DB`). Incompatible with `--upload-only` and `--only-phrase`.
- **`--verify-stt`:** first runs the same **loudness** pass as `--verify-loudness`, then Deepgram STT. Exit 1 if **either** step fails. Incompatible with `--upload-only` (and does not run TTS or S3). **ffmpeg** and `DEEPGRAM_API_KEY` are required. Entries whose expected `text` is a single character (after trim) are **skipped** for both loudness and STT (warning only; counted in `ok` / `skip`).


## Audio post-processing

Each generated MP3 is post-processed by ffmpeg after Deepgram synthesis:

1. **50 ms fade-out** applied at the end of the clip (`afade=t=out`).
2. **5 ms tail trim** to remove any residual click after the fade.

This eliminates the audible click/pop that Deepgram occasionally appends. The post-process pipeline version is included in the cache hash, so upgrading the pipeline automatically regenerates clips on the next run.

Pass `--no-audio-pos` to write Deepgram output as-is (useful for debugging raw TTS audio). Raw and processed clips have separate cache entries, so switching the flag is always safe.

## Local output

```
output/
  audio/
    {phraseIndex}-{en|es}-{field}.mp3
  manifest.json
  .cache/
    hashes.json
```

Transcript rows are flattened to jobs such as `{i}-en-first-intro`, `{i}-en-second-intro`, `{i}-en-question`, `{i}-es-question` (empty strings skipped).

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
