import type { Language, S3PathConfig } from '@ai-spanish/logic';

export type { S3PathConfig };

/** One TTS synthesis unit after flattening a transcript phrase. */
export interface TtsJob {
  /** Stable clip id `${phraseName}-${field}` (e.g. `perdona-first-intro`). */
  id: string;
  /** Transcript JSON `"index"` on the phrase object (same for each clip of that phrase). */
  index: number;
  /** Phrase slug (e.g. `perdona`) used as the clip stem. */
  phraseName: string;
  language: Language;
  text: string;
  /** Deepgram voice model id (e.g. aura-2-pandora-en). */
  voice: string;
}

/** One row in output/manifest.json */
export interface ManifestEntry {
  id: string;
  /** Transcript JSON phrase `"index"` (same for all clips of that phrase). */
  index: number;
  language: Language;
  text: string;
  voice: string;
  /** Relative path from output dir, e.g. audio/perdona-first-intro.mp3 */
  localFile: string;
  /** S3 object key when uploaded; omitted in --local-only runs. */
  s3Key?: string;
  hash: string;
  createdAt: string;
}

/** On-disk cache: job id → content hash */
export type HashCache = Record<string, string>;

export type TranscriptCliSource =
  | { source: 'file'; path: string }
  | { source: 'supabase'; lessonId: string };

export interface CliOptions {
  /** Set when TTS needs a transcript; omitted for --upload-only / verify-only modes. */
  transcriptSource: TranscriptCliSource | null;
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
  /** STT every manifest MP3 and compare to manifest text; no TTS or S3. */
  verifyStt: boolean;
  /**
   * ffmpeg volumedetect peak check on every manifest MP3 (standalone, or
   * implied when `verifyStt` is set — not doubled).
   */
  verifyLoudness: boolean;
  /**
   * If set, regenerate only clips whose transcript phrase has this `"index"`
   * value in JSON, then merge into existing manifest. Requires a prior full batch.
   */
  onlyPhrase: number | undefined;
}
