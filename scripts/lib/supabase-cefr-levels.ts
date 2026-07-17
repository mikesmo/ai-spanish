import { createClient } from '@supabase/supabase-js';

import { requireSupabaseEnv } from './supabase-lesson-transcripts.js';

export interface CefrLevelWordSeedRow {
  level: string;
  word: string;
  pos: string | null;
}

/** Upserts normalized+deduped word rows for a single CEFR level. */
export async function upsertCefrLevelWords(
  rows: readonly CefrLevelWordSeedRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { url, serviceRoleKey } = requireSupabaseEnv();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase
    .from('cefr_level_words')
    .upsert(rows, { onConflict: 'level,word' });
  if (error) {
    throw new Error(error.message);
  }
}

/** Upserts grammar-item rows for a single CEFR level. */
export async function upsertCefrLevelGrammar(
  level: string,
  grammarItems: readonly string[],
): Promise<void> {
  if (grammarItems.length === 0) return;
  const { url, serviceRoleKey } = requireSupabaseEnv();
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows = grammarItems.map((grammarItem) => ({ level, grammar_item: grammarItem }));
  const { error } = await supabase
    .from('cefr_level_grammar')
    .upsert(rows, { onConflict: 'level,grammar_item' });
  if (error) {
    throw new Error(error.message);
  }
}
