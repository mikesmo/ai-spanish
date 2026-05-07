import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { tryCreateSupabaseServerClient } from '@/lib/supabase/server';

function getSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

/** Supabase JS client elevated with the caller's JWT (cookie session or Bearer). */
export type ApiSupabaseSuccess = {
  userId: string;
  supabase: SupabaseClient;
};

export async function resolveAuthenticatedSupabaseForApi(
  request: NextRequest,
): Promise<{ ok: true; data: ApiSupabaseSuccess } | { ok: false; response: NextResponse }> {
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
    const supabase = createClient(env.url, env.key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      };
    }
    return {
      ok: true,
      data: {
        userId: user.id,
        supabase,
      },
    };
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
  return {
    ok: true,
    data: {
      userId: user.id,
      supabase: cookieClient,
    },
  };
}
