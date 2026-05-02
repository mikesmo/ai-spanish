-- Run after `npm run push:transcripts` when `lesson_transcripts` was empty during the
-- initial migration (e.g. after `supabase db reset`). Idempotent for lessons 1 and 2.
--
--   psql $DATABASE_URL -f supabase/seed_lesson_catalog_after_transcripts.sql
--   (or paste into Supabase SQL editor)

INSERT INTO public.lesson_catalog (lesson_id, course_level_id, title, description, sort_order)
SELECT
  '1',
  '11111111-1111-1111-1111-111111111111',
  'Lesson 1',
  'Greetings, apologies, and essential phrases to get by.',
  1
WHERE EXISTS (SELECT 1 FROM public.lesson_transcripts WHERE lesson_id = '1')
ON CONFLICT (lesson_id) DO NOTHING;

INSERT INTO public.lesson_catalog (lesson_id, course_level_id, title, description, sort_order)
SELECT
  '2',
  '11111111-1111-1111-1111-111111111111',
  'Lesson 2',
  'Asking and answering questions in everyday situations.',
  2
WHERE EXISTS (SELECT 1 FROM public.lesson_transcripts WHERE lesson_id = '2')
ON CONFLICT (lesson_id) DO NOTHING;
