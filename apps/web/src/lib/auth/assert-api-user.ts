import { NextResponse } from 'next/server';
import { tryCreateSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Ensures the request has a valid Supabase session. Use at the start of sensitive API routes.
 * When Supabase env is missing (local dev), returns 503 so behavior matches a partially configured app.
 */
export async function assertApiUser(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const client = await tryCreateSupabaseServerClient();
  if (!client) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication is not configured' },
        { status: 503 },
      ),
    };
  }
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true };
}
