-- Per-user persisted lesson completions (full session history + final checkpoint).

CREATE TABLE public.user_lesson_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  lesson_id text NOT NULL,
  completed_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE (user_id, run_id)
);

CREATE INDEX user_lesson_completions_user_lesson_completed_idx
  ON public.user_lesson_completions (user_id, lesson_id, completed_at DESC);

COMMENT ON TABLE public.user_lesson_completions IS
  'Snapshot when a learner completes a lesson run; payload matches lessonSessionCompletionPayloadSchema.';

ALTER TABLE public.user_lesson_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_lesson_completions_insert_own"
  ON public.user_lesson_completions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_lesson_completions_update_own"
  ON public.user_lesson_completions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_lesson_completions_select_own"
  ON public.user_lesson_completions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
