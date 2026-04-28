'use client';

import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { safeNextPath } from '@/lib/auth/safe-next-path';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function AuthCallbackClient(): JSX.Element {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const run = async (): Promise<void> => {
      const params = new URLSearchParams(
        typeof window !== 'undefined' ? window.location.search : '',
      );
      const next = safeNextPath(params.get('next'));

      let supabase;
      try {
        supabase = createSupabaseBrowserClient();
      } catch {
        router.replace('/login');
        return;
      }

      const code = params.get('code');

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session) {
            router.replace(next);
            router.refresh();
            return;
          }
          router.replace('/login');
          return;
        }
        router.replace(next);
        router.refresh();
        return;
      }

      // Recovery/sign-in links often put tokens in the hash; the server never sees fragments,
      // so a Route Handler cannot exchange them — handle here on the client.
      const rawHash = typeof window !== 'undefined' ? window.location.hash : '';
      if (rawHash.length > 1) {
        const hashParams = new URLSearchParams(rawHash.slice(1));
        const access_token = hashParams.get('access_token');
        const refresh_token = hashParams.get('refresh_token');
        if (access_token && refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (sessionError) {
            router.replace('/login');
            return;
          }
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}`,
          );
          router.replace(next);
          router.refresh();
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        router.replace(next);
        router.refresh();
        return;
      }

      router.replace('/login');
    };

    void run();
  }, [router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <p className="text-sm text-gray-500">Signing you in…</p>
    </div>
  );
}
