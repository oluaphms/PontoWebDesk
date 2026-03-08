/**
 * URL base do app para redirects, auth callback e APIs.
 * Em desenvolvimento usa VITE_APP_URL (ex.: http://localhost:3010) para não
 * depender de window.location.origin quando a porta pode variar.
 */
const DEV_FALLBACK = 'http://localhost:3010';

export function getAppBaseUrl(): string {
  const fromEnv = (
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_APP_URL ?? import.meta.env?.VITE_SUPABASE_REDIRECT)) ||
    ''
  )
    .toString()
    .trim()
    .replace(/\/$/, '');
  if (fromEnv && /^https?:\/\//.test(fromEnv)) return fromEnv;
  if (typeof window !== 'undefined' && window.location?.origin)
    return String(window.location.origin).replace(/\/$/, '');
  return DEV_FALLBACK;
}
