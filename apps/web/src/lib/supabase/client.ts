import { createStorageFromOptions } from '@supabase/ssr/dist/module/cookies';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client with cookie-backed session storage for middleware SSR.
 *
 * We use `flowType: 'implicit'` instead of `@supabase/ssr`'s createBrowserClient (which
 * forces PKCE). PKCE password-recovery links require a code verifier stored in the same
 * browser that requested the reset; email links are often opened elsewhere, so exchange
 * fails and users were redirected to /login. Implicit recovery puts tokens in the URL
 * hash, which AuthCallbackClient handles.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.trim() || !key?.trim()) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
  }

  const isBrowser = typeof window !== 'undefined';
  const { storage } = createStorageFromOptions({ cookieEncoding: 'base64url' }, false);

  return createClient(url, key, {
    auth: {
      flowType: 'implicit',
      autoRefreshToken: isBrowser,
      detectSessionInUrl: isBrowser,
      persistSession: true,
      storage,
    },
  });
}
