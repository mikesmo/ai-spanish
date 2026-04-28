/**
 * Allows only same-app relative paths after login redirects (blocks open redirects).
 */
export function safeNextPath(raw: string | undefined | null): string {
  if (raw == null || raw === '') return '/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  return trimmed;
}
