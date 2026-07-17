-- Lifetime (cross-lesson) per-word and per-grammar-item mastery status per user,
-- plus CEFR level reference content and the learner's self-declared level.

-- ---------------------------------------------------------------------------
-- Lifetime mastery tables. Seeded into every lesson session (see
-- useLessonSession's initialItemScores) and updated whenever a lesson
-- completes (see /api/lesson-completions). Mirrors the in-session ItemScore
-- shape (packages/logic/src/itemMastery.ts) minus `lastUpdatedAtEventSeq`,
-- which is a per-session sequence number with no cross-session meaning.
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_word_mastery (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word text NOT NULL,
  trials_eff double precision NOT NULL,
  success_sum_eff double precision NOT NULL,
  stability double precision NOT NULL,
  mastery double precision NOT NULL,
  claimed_at_level text CHECK (claimed_at_level IN ('A1','A2','B1','B2','C1','C2')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, word)
);

COMMENT ON TABLE public.user_word_mastery IS
  'Lifetime per-word mastery (ItemScore) per user, seeded into every lesson session and updated at lesson completion. claimed_at_level is set when the word was seeded from a declared CEFR level "should know" list and is preserved across later practice upserts.';

CREATE TABLE public.user_grammar_mastery (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grammar_item text NOT NULL,
  trials_eff double precision NOT NULL,
  success_sum_eff double precision NOT NULL,
  stability double precision NOT NULL,
  mastery double precision NOT NULL,
  claimed_at_level text CHECK (claimed_at_level IN ('A1','A2','B1','B2','C1','C2')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, grammar_item)
);

COMMENT ON TABLE public.user_grammar_mastery IS
  'Lifetime per-grammar-item mastery (ItemScore) per user, seeded into every lesson session and updated at lesson completion. claimed_at_level mirrors user_word_mastery.claimed_at_level.';

CREATE INDEX user_word_mastery_user_updated_idx
  ON public.user_word_mastery (user_id, updated_at DESC);

CREATE INDEX user_grammar_mastery_user_updated_idx
  ON public.user_grammar_mastery (user_id, updated_at DESC);

ALTER TABLE public.user_word_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_grammar_mastery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_word_mastery_insert_own"
  ON public.user_word_mastery
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_word_mastery_update_own"
  ON public.user_word_mastery
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_word_mastery_select_own"
  ON public.user_word_mastery
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_grammar_mastery_insert_own"
  ON public.user_grammar_mastery
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_grammar_mastery_update_own"
  ON public.user_grammar_mastery
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_grammar_mastery_select_own"
  ON public.user_grammar_mastery
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- CEFR level reference content — public reference data (like course_levels),
-- seeded from input/cefr_levels/<level>/{words.json,grammar.json} by the
-- push:cefr-levels script. Not user-specific.
-- ---------------------------------------------------------------------------

CREATE TABLE public.cefr_level_words (
  level text NOT NULL CHECK (level IN ('A1','A2','B1','B2','C1','C2')),
  word text NOT NULL,
  -- Source category label from words.json (e.g. "noun", "interjection");
  -- informational only, not used for matching.
  pos text,
  PRIMARY KEY (level, word)
);

COMMENT ON TABLE public.cefr_level_words IS
  'Reference "should know" word list per CEFR level; seeded from input/cefr_levels/<level>/words.json.';

CREATE TABLE public.cefr_level_grammar (
  level text NOT NULL CHECK (level IN ('A1','A2','B1','B2','C1','C2')),
  grammar_item text NOT NULL,
  PRIMARY KEY (level, grammar_item)
);

COMMENT ON TABLE public.cefr_level_grammar IS
  'Reference "should know" grammar-item list per CEFR level; seeded from input/cefr_levels/<level>/grammar.json.';

ALTER TABLE public.cefr_level_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cefr_level_grammar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cefr_level_words_select_authenticated"
  ON public.cefr_level_words
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "cefr_level_grammar_select_authenticated"
  ON public.cefr_level_grammar
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- Learner's self-declared CEFR level.
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_profile (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  declared_level text CHECK (declared_level IN ('A1','A2','B1','B2','C1','C2')),
  declared_level_set_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_profile IS
  'Per-user settings; currently just the self-declared CEFR level set from Settings.';

ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profile_insert_own"
  ON public.user_profile
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_profile_update_own"
  ON public.user_profile
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_profile_select_own"
  ON public.user_profile
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
