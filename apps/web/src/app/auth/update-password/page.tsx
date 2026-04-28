import type { JSX } from 'react';
import { UpdatePasswordForm } from './UpdatePasswordForm';

export default function UpdatePasswordPage(): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white">
      <UpdatePasswordForm />
    </div>
  );
}
