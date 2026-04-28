'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup';

export function LoginForm({ defaultNext }: { defaultNext: string }): JSX.Element {
  const router = useRouter();
  const forgotHref =
    defaultNext === '/'
      ? '/forgot-password'
      : `/forgot-password?next=${encodeURIComponent(defaultNext)}`;
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setMessage(null);
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

      if (mode === 'signup') {
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(defaultNext)}`;
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) {
          setMessage(error.message);
          setSubmitting(false);
          return;
        }
        setMessage('Check your email to confirm your account, then sign in.');
        setSubmitting(false);
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
        setSubmitting(false);
        return;
      }
      router.push(defaultNext);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-[390px] mx-auto px-8 py-16">
      <h1 className="text-2xl font-semibold text-gray-900 text-center mb-2">AI Spanish</h1>
      <p className="text-sm text-gray-500 text-center mb-8">
        {mode === 'signin' ? 'Sign in to continue' : 'Create an account'}
      </p>

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-400"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Password</span>
          <input
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-400"
          />
        </label>

        {mode === 'signin' && (
          <p className="text-right text-sm">
            <Link
              href={forgotHref}
              className="font-medium text-gray-900 underline-offset-2 hover:underline"
            >
              Forgot password?
            </Link>
          </p>
        )}

        {message && (
          <p
            className={`text-sm ${message.includes('Check your email') ? 'text-gray-600' : 'text-[#D85A30]'}`}
            role="alert"
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
        >
          {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        {mode === 'signin' ? (
          <>
            No account?{' '}
            <button
              type="button"
              className="font-medium text-gray-900 underline-offset-2 hover:underline"
              onClick={() => {
                setMode('signup');
                setMessage(null);
              }}
            >
              Sign up
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button
              type="button"
              className="font-medium text-gray-900 underline-offset-2 hover:underline"
              onClick={() => {
                setMode('signin');
                setMessage(null);
              }}
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
