-- Course levels + lesson catalog (links to lesson_transcripts).
-- Seed inserts catalog rows only when matching transcripts exist (run push:transcripts first).

CREATE TABLE public.course_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.course_levels IS 'Course tier (e.g. beginner); slug used in API ?courseLevel=';

CREATE TABLE public.lesson_catalog (
  lesson_id text NOT NULL PRIMARY KEY
    REFERENCES public.lesson_transcripts (lesson_id)
    ON DELETE RESTRICT,
  course_level_id uuid NOT NULL
    REFERENCES public.course_levels (id)
    ON DELETE RESTRICT,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL
);

COMMENT ON TABLE public.lesson_catalog IS 'Navigable lessons per course level; one row per transcript lesson in the app shell.';

CREATE INDEX lesson_catalog_course_level_id_idx ON public.lesson_catalog (course_level_id);
CREATE INDEX lesson_catalog_course_level_sort_idx ON public.lesson_catalog (course_level_id, sort_order);

CREATE UNIQUE INDEX lesson_catalog_level_sort_unique
  ON public.lesson_catalog (course_level_id, sort_order);

ALTER TABLE public.course_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "course_levels_select_authenticated"
  ON public.course_levels
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "lesson_catalog_select_authenticated"
  ON public.lesson_catalog
  FOR SELECT
  TO authenticated
  USING (true);

-- Stable id for seed FKs (replace if you prefer gen_random_uuid-only flows)
INSERT INTO public.course_levels (id, slug, title, sort_order) VALUES (
  '11111111-1111-1111-1111-111111111111',
  'beginner',
  'Beginner',
  0
);

INSERT INTO public.lesson_catalog (lesson_id, course_level_id, title, description, sort_order)
SELECT
  '1',
  '11111111-1111-1111-1111-111111111111',
  'Lesson 1',
  'Greetings, apologies, and essential phrases to get by.',
  1
WHERE EXISTS (SELECT 1 FROM public.lesson_transcripts WHERE lesson_id = '1');

INSERT INTO public.lesson_catalog (lesson_id, course_level_id, title, description, sort_order)
SELECT
  '2',
  '11111111-1111-1111-1111-111111111111',
  'Lesson 2',
  'Asking and answering questions in everyday situations.',
  2
WHERE EXISTS (SELECT 1 FROM public.lesson_transcripts WHERE lesson_id = '2');
