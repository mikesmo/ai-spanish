export type LessonListEntry = {
  id: string;
  title: string;
  description: string;
};

/** Default lesson when no `?lesson=` is specified (API + legacy single-lesson flows). */
export const DEFAULT_TRANSCRIPT_LESSON_ID = '1' as const;

/** Default course tier for GET `/api/lessons` when `?courseLevel=` is omitted. */
export const DEFAULT_COURSE_LEVEL_SLUG = 'beginner' as const;

/** Authoritative list of app lessons; ids match transcript + S3 layout (`lesson` + id). */
export const lessons: readonly LessonListEntry[] = [
  {
    id: '1',
    title: 'Lesson 1',
    description:
      'Greetings, apologies, and essential phrases to get by.',
  },
  {
    id: '2',
    title: 'Lesson 2',
    description:
      'Asking and answering questions in everyday situations.',
  },
] as const;

/** Matches `lesson_transcripts.lesson_id` check: positive integer string, no leading zeros. */
const TRANSCRIPT_LESSON_ID_SYNTAX = /^[1-9][0-9]*$/;

/**
 * True when `lessonId` is allowed for stored transcripts (API + DB).
 * Independent of catalog membership so new lessons can be uploaded before UI lists them.
 */
export function isTranscriptLessonIdSyntaxValid(lessonId: string): boolean {
  return TRANSCRIPT_LESSON_ID_SYNTAX.test(lessonId);
}

/**
 * Normalizes `?lesson=` query values for transcript routes.
 * Empty or syntactically invalid values fall back to {@link DEFAULT_TRANSCRIPT_LESSON_ID}.
 */
export function resolveTranscriptLessonQueryParam(
  raw: string | null | undefined,
): string {
  const s = raw?.trim() ?? '';
  if (s === '' || !isTranscriptLessonIdSyntaxValid(s)) {
    return DEFAULT_TRANSCRIPT_LESSON_ID;
  }
  return s;
}

export function getLessonTitle(lessonId: string): string {
  return lessons.find((l) => l.id === lessonId)?.title ?? `Lesson ${lessonId}`;
}

/** True when `lessonId` is syntactically valid for `lesson_transcripts` / transcript API. */
export function isValidTranscriptLessonId(lessonId: string): boolean {
  return isTranscriptLessonIdSyntaxValid(lessonId);
}

/**
 * Path + query for GET transcript, relative to web origin. Single source for web + mobile fetch URLs.
 * Example: `"/api/transcript?lesson=1"`
 */
export function transcriptPathWithLesson(lessonId: string): string {
  const params = new URLSearchParams({ lesson: lessonId });
  return `/api/transcript?${params.toString()}`;
}

/**
 * Path + query for GET lesson catalog (web + mobile), relative to web origin.
 * Example: `"/api/lessons?courseLevel=beginner"`
 */
export function lessonsApiPath(courseLevelSlug?: string): string {
  const slug = (courseLevelSlug?.trim() || DEFAULT_COURSE_LEVEL_SLUG).trim();
  const params = new URLSearchParams({ courseLevel: slug });
  return `/api/lessons?${params.toString()}`;
}

/**
 * S3 folder segment under the content prefix for pre-batched TTS (e.g. `lesson1`).
 * Matches tts-batch `--lesson` and `buildS3AudioKey` layout.
 */
export function s3LessonFolderForTranscriptLessonId(lessonId: string): string {
  return `lesson${lessonId}`;
}
