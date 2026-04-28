import type { JSX } from 'react';
import { LoginForm } from './LoginForm';
import { safeNextPath } from '@/lib/auth/safe-next-path';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const { next } = await searchParams;
  const nextPath = safeNextPath(next);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <LoginForm defaultNext={nextPath} />
    </div>
  );
}
