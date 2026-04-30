-- Lesson transcripts: single row per lesson; phrases is JSON array matching TranscriptResponse.
-- Row data is not seeded here — load via `npm run push:transcripts` (see supabase/README.md).

CREATE TABLE public.lesson_transcripts (
  lesson_id text PRIMARY KEY,
  phrases jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT lesson_transcripts_lesson_id_check CHECK (lesson_id ~ '^[1-9][0-9]*$')
);

COMMENT ON TABLE public.lesson_transcripts IS 'Phrase decks per lesson; phrases matches TranscriptResponse / Phrase[].';

ALTER TABLE public.lesson_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lesson_transcripts_select_authenticated"
  ON public.lesson_transcripts
  FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.set_lesson_transcripts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER lesson_transcripts_updated_at
  BEFORE UPDATE ON public.lesson_transcripts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_lesson_transcripts_updated_at();
