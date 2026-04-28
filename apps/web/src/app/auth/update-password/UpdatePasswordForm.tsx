'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function UpdatePasswordForm(): JSX.Element {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!cancelled) {
          setHasSession(!!session);
          setSessionChecked(true);
        }
      } catch {
        if (!cancelled) {
          setHasSession(false);
          setSessionChecked(true);
        }
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setMessage(null);
    if (password !== confirm) {
      setMessage('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setMessage('Password must be at least 6 characters.');
      return;
    }
    setSubmitting(true);
    try {
      let supabase;
      try {
        supabase = createSupabaseBrowserClient();
      } catch {
        setMessage('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
        setSubmitting(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMessage(error.message);
        setSubmitting(false);
        return;
      }
      router.push('/');
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  if (!sessionChecked) {
    return (
      <div className="w-full max-w-[390px] mx-auto px-8 py-16">
        <p className="text-sm text-gray-500 text-center">Loading…</p>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="w-full max-w-[390px] mx-auto px-8 py-16">
        <h1 className="text-2xl font-semibold text-gray-900 text-center mb-2">AI Spanish</h1>
        <p className="text-sm text-gray-600 text-center mb-6">
          This reset link is invalid or has expired. Request a new one or sign in.
        </p>
        <div className="flex flex-col gap-3 text-center text-sm">
          <Link
            href="/forgot-password"
            className="font-medium text-gray-900 underline-offset-2 hover:underline"
          >
            Forgot password
          </Link>
          <Link href="/login" className="font-medium text-gray-900 underline-offset-2 hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[390px] mx-auto px-8 py-16">
      <h1 className="text-2xl font-semibold text-gray-900 text-center mb-2">AI Spanish</h1>
      <p className="text-sm text-gray-500 text-center mb-8">Choose a new password</p>

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-400"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-400"
          />
        </label>

        {message && (
          <p className="text-sm text-[#D85A30]" role="alert">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
        >
          {submitting ? 'Please wait…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
