import { NextResponse } from 'next/server';
import { tryCreateSupabaseServerClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/auth/safe-next-path';

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = safeNextPath(requestUrl.searchParams.get('next'));

  if (!code) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const supabase = await tryCreateSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
