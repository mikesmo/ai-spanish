import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { tryCreateSupabaseServerClient } from '@/lib/supabase/server';

function getSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

/**
 * Ensures the request has a valid Supabase session (cookie-based browser session or
 * `Authorization: Bearer <access_token>` for native / cross-origin clients).
 */
export async function assertApiUser(
  request: NextRequest,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const env = getSupabaseEnv();
  if (!env) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication is not configured' },
        { status: 503 },
      ),
    };
  }

  const bearer = request.headers.get('authorization');
  const token = bearer?.startsWith('Bearer ') ? bearer.slice(7).trim() : '';

  if (token) {
    const client = createClient(env.url, env.key);
    const {
      data: { user },
      error,
    } = await client.auth.getUser(token);
    if (error || !user) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      };
    }
    return { ok: true };
  }

  const cookieClient = await tryCreateSupabaseServerClient();
  if (!cookieClient) {
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
  } = await cookieClient.auth.getUser();
  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true };
}
