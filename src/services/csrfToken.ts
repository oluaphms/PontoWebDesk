/** Token CSRF em memória volátil (nunca localStorage). */
let csrfTokenCache: string | null = null;

export function setCsrfToken(token: string | null): void {
  const next = String(token || '').trim();
  csrfTokenCache = next || null;
}

export function getCsrfToken(): string | null {
  return csrfTokenCache;
}

export function clearCsrfToken(): void {
  csrfTokenCache = null;
}
