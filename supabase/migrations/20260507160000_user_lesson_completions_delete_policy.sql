-- Allow learners to delete their own completion rows (e.g. home-page lesson reset).

CREATE POLICY "user_lesson_completions_delete_own"
  ON public.user_lesson_completions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
