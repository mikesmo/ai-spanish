-- In-progress lesson checkpoint per user + lesson (for resume when queue not drained).

CREATE TABLE public.user_lesson_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id text NOT NULL,
  checkpoint jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

COMMENT ON TABLE public.user_lesson_progress IS
  'Latest session-engine checkpoint while a lesson run is incomplete; cleared when the user completes the lesson.';

CREATE INDEX user_lesson_progress_user_updated_idx
  ON public.user_lesson_progress (user_id, updated_at DESC);

ALTER TABLE public.user_lesson_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_lesson_progress_insert_own"
  ON public.user_lesson_progress
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_lesson_progress_update_own"
  ON public.user_lesson_progress
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_lesson_progress_select_own"
  ON public.user_lesson_progress
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_lesson_progress_delete_own"
  ON public.user_lesson_progress
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
