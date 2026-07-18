-- Allow learners to delete their own lifetime mastery and profile rows
-- (e.g. the dev-only "reset all progress" control in Settings).

CREATE POLICY "user_word_mastery_delete_own"
  ON public.user_word_mastery
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_grammar_mastery_delete_own"
  ON public.user_grammar_mastery
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_profile_delete_own"
  ON public.user_profile
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
