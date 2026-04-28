import { tryCreateSupabaseServerClient } from '@/lib/supabase/server';

/** For Server Components or actions; returns null if there is no valid session or Supabase is unset. */
export async function getAuthenticatedUser() {
  const supabase = await tryCreateSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}
