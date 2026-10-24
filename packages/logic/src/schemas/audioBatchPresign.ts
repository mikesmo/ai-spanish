import { z } from 'zod';
import {
  AUDIO_CLIP_SEGMENTS,
  AUDIO_PHRASE_NAME_PATTERN,
  LESSON_AUDIO_BATCH_MAX_CLIPS,
} from '../lessonAudioClips';

export const audioBatchPresignRequestSchema = z.object({
  /** S3 lesson folder (e.g. `lesson1`); omitted uses the server default. */
  lesson: z.string().optional(),
  clips: z
    .array(
      z.object({
        phrase: z.string().regex(AUDIO_PHRASE_NAME_PATTERN),
        segment: z.enum(AUDIO_CLIP_SEGMENTS),
      }),
    )
    .min(1)
    .max(LESSON_AUDIO_BATCH_MAX_CLIPS),
});

export type AudioBatchPresignRequest = z.infer<typeof audioBatchPresignRequestSchema>;

export const audioBatchPresignResponseSchema = z.object({
  /** Presigned URL lifetime in seconds. */
  expiresIn: z.number().int().positive(),
  /**
   * Keyed by clip id (`{phrase}-{segment}`). Requested clips with no S3 object
   * are omitted. `version` is the object's ETag, which changes when the audio does.
   */
  clips: z.record(z.string(), z.object({ url: z.string(), version: z.string() })),
});

export type AudioBatchPresignResponse = z.infer<typeof audioBatchPresignResponseSchema>;
