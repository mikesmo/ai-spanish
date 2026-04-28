'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function ForgotPasswordForm({ loginNext }: { loginNext: string }): JSX.Element {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loginHref =
    loginNext === '/'
      ? '/login'
      : `/login?next=${encodeURIComponent(loginNext)}`;

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setMessage(null);
    setSuccess(false);
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

      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/auth/update-password')}`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        setMessage(error.message);
        setSubmitting(false);
        return;
      }
      setSuccess(true);
      setMessage(
        'If an account exists for that email, we sent a link to reset your password. Check your inbox.',
      );
      setSubmitting(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-[390px] mx-auto px-8 py-16">
      <h1 className="text-2xl font-semibold text-gray-900 text-center mb-2">AI Spanish</h1>
      <p className="text-sm text-gray-500 text-center mb-8">Reset your password</p>

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={success}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-400 disabled:opacity-60"
          />
        </label>

        {message && (
          <p
            className={`text-sm ${success ? 'text-gray-600' : 'text-[#D85A30]'}`}
            role="alert"
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || success}
          className="mt-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
        >
          {submitting ? 'Please wait…' : 'Send reset link'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        <Link
          href={loginHref}
          className="font-medium text-gray-900 underline-offset-2 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
