/** Token CSRF em memória volátil (nunca localStorage). */
let csrfTokenCache: string | null = null;

export const CSRF_COOKIE_NAME = 'pwd_csrf';

function readCsrfFromDocumentCookie(): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      const value = decodeURIComponent(rest.join('=') || '').trim();
      return value || null;
    }
  }
  return null;
}

export function setCsrfToken(token: string | null): void {
  const next = String(token || '').trim();
  csrfTokenCache = next || null;
}

export function getCsrfToken(): string | null {
  if (csrfTokenCache) return csrfTokenCache;
  const fromCookie = readCsrfFromDocumentCookie();
  if (fromCookie) {
    csrfTokenCache = fromCookie;
    return fromCookie;
  }
  return null;
}

export function clearCsrfToken(): void {
  csrfTokenCache = null;
}
