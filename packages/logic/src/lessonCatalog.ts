export type LessonListEntry = {
  id: string;
  title: string;
  description: string;
};

/** Default lesson when no `?lesson=` is specified (API + legacy single-lesson flows). */
export const DEFAULT_TRANSCRIPT_LESSON_ID = '1' as const;

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

const lessonIds = new Set(lessons.map((l) => l.id));

export function getLessonTitle(lessonId: string): string {
  return lessons.find((l) => l.id === lessonId)?.title ?? `Lesson ${lessonId}`;
}

/** True when `lessonId` is a known transcript lesson (matches API whitelist). */
export function isValidTranscriptLessonId(lessonId: string): boolean {
  return lessonIds.has(lessonId);
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
 * S3 folder segment under the content prefix for pre-batched TTS (e.g. `lesson1`).
 * Matches tts-batch `--lesson` and `buildS3AudioKey` layout.
 */
export function s3LessonFolderForTranscriptLessonId(lessonId: string): string {
  return `lesson${lessonId}`;
}
