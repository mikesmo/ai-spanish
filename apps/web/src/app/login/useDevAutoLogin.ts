'use client';

import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type DevAutoLoginStatus = 'disabled' | 'checking' | 'signing-in' | 'success' | 'error';

interface UseDevAutoLoginOptions {
  onSuccess: () => void;
}

interface UseDevAutoLoginResult {
  status: DevAutoLoginStatus;
  errorMessage: string | null;
}

// `process.env.NODE_ENV` is statically replaced by Next.js at build time, so this
// entire feature (including the credential env vars below) is dead-code-eliminated
// from production bundles.
const isDev = process.env.NODE_ENV === 'development';
const devEmail = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN_EMAIL;
const devPassword = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN_PASSWORD;
const isConfigured = Boolean(devEmail?.trim()) && Boolean(devPassword?.trim());

/**
 * Development convenience: automatically signs in with a fixed account so
 * engineers don't have to re-enter credentials on every reload/logout.
 *
 * Fully disabled outside development, and a no-op unless both
 * `NEXT_PUBLIC_DEV_AUTO_LOGIN_EMAIL` and `NEXT_PUBLIC_DEV_AUTO_LOGIN_PASSWORD`
 * are set (in the git-ignored `.env.local`).
 */
export function useDevAutoLogin({ onSuccess }: UseDevAutoLoginOptions): UseDevAutoLoginResult {
  const isEnabled = isDev && isConfigured;
  const [status, setStatus] = useState<DevAutoLoginStatus>(isEnabled ? 'checking' : 'disabled');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasRunRef = useRef(false);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    if (!isEnabled || hasRunRef.current) return;
    hasRunRef.current = true;

    let cancelled = false;

    async function run(): Promise<void> {
      let supabase;
      try {
        supabase = createSupabaseBrowserClient();
      } catch {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage('Supabase is not configured for dev auto-login.');
        }
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;

      if (sessionData.session) {
        setStatus('success');
        onSuccessRef.current();
        return;
      }

      setStatus('signing-in');
      const { error } = await supabase.auth.signInWithPassword({
        email: devEmail as string,
        password: devPassword as string,
      });
      if (cancelled) return;

      if (error) {
        setStatus('error');
        setErrorMessage(`Dev auto-login failed: ${error.message}`);
        return;
      }

      setStatus('success');
      onSuccessRef.current();
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  return { status, errorMessage };
}
