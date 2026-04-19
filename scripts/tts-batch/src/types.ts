import type { Language, S3PathConfig } from '@ai-spanish/logic';

export type { S3PathConfig };

/** One TTS synthesis unit after flattening a transcript phrase. */
export interface TtsJob {
  id: string;
  language: Language;
  text: string;
  /** Deepgram voice model id (e.g. aura-2-pandora-en). */
  voice: string;
}

/** One row in output/manifest.json */
export interface ManifestEntry {
  id: string;
  language: Language;
  text: string;
  voice: string;
  /** Relative path from output dir, e.g. audio/0-en-intro.mp3 */
  localFile: string;
  /** S3 object key when uploaded; omitted in --local-only runs. */
  s3Key?: string;
  hash: string;
  createdAt: string;
}

/** On-disk cache: job id → content hash */
export type HashCache = Record<string, string>;

export interface CliOptions {
  inputPath: string;
  outDir: string;
  bucket: string | undefined;
  force: boolean;
  localOnly: boolean;
  /** Skip TTS; upload existing manifest + audio from --out to S3. */
  uploadOnly: boolean;
  /** Optional lesson segment under AUDIO_CONTENT_PREFIX; overrides S3_LESSON env. */
  lesson: string | undefined;
  /** Skip ffmpeg post-processing (fade-out + tail trim); write raw Deepgram output as-is. */
  noAudioPos: boolean;
}
