import type { JSX } from 'react';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { safeNextPath } from '@/lib/auth/safe-next-path';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const { next } = await searchParams;
  const loginNext = safeNextPath(next);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <ForgotPasswordForm loginNext={loginNext} />
    </div>
  );
}
