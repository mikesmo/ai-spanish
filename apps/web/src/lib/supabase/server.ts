import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

function getSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

function createWithCookieStore(
  url: string,
  key: string,
  cookieStore: Awaited<ReturnType<typeof cookies>>,
) {
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Ignore when called from a Server Component that cannot set cookies.
        }
      },
    },
  });
}

/** Use in Route Handlers and auth callback when Supabase may be unset (local dev). */
export async function tryCreateSupabaseServerClient() {
  const env = getSupabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createWithCookieStore(env.url, env.key, cookieStore);
}

/** Use when env must be present; throws if misconfigured. */
export async function createSupabaseServerClient(): Promise<ReturnType<typeof createServerClient>> {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
  }
  const cookieStore = await cookies();
  return createWithCookieStore(env.url, env.key, cookieStore);
}
