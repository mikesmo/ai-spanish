-- Allow additional transcript lesson rows (e.g. lesson 3+). Keeps ids aligned with
-- @ai-spanish/logic `isTranscriptLessonIdSyntaxValid`: positive decimal string, no leading zeros.

ALTER TABLE public.lesson_transcripts
  DROP CONSTRAINT lesson_transcripts_lesson_id_check;

ALTER TABLE public.lesson_transcripts
  ADD CONSTRAINT lesson_transcripts_lesson_id_check
  CHECK (lesson_id ~ '^[1-9][0-9]*$');
