import type { Language } from '@ai-spanish/logic';

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
}
