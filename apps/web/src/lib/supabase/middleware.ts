import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth/safe-next-path';

const PUBLIC_PREFIXES = [
  '/login',
  '/forgot-password',
  '/auth/callback',
  '/auth/update-password',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isProtectedPath(pathname: string): boolean {
  if (isPublicPath(pathname)) return false;
  if (pathname === '/api/authenticate' && process.env.DEEPGRAM_ENV === 'development') {
    return false;
  }
  return true;
}

function copyCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie.name, cookie.value);
  });
  return to;
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url?.trim() || !key?.trim()) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Authentication is not configured' },
        { status: 503 },
      );
    }
    return NextResponse.next({ request });
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value: v, options }) =>
          supabaseResponse.cookies.set(name, v, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (user && pathname === '/login') {
    const next = safeNextPath(request.nextUrl.searchParams.get('next'));
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = next;
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === '/forgot-password') {
    const next = safeNextPath(request.nextUrl.searchParams.get('next'));
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = next;
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  if (!user && isProtectedPath(pathname)) {
    if (pathname.startsWith('/api/')) {
      const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return copyCookies(supabaseResponse, res);
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    const nextParam = pathname + request.nextUrl.search;
    loginUrl.searchParams.set('next', nextParam);
    const redirect = NextResponse.redirect(loginUrl);
    return copyCookies(supabaseResponse, redirect);
  }

  return supabaseResponse;
}
