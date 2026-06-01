const COOKIE_SESSION_TOKEN = '__http_only_cookie_session__';
const AUTH_TOKEN_STORAGE_KEY = 'pwd_auth_token';

let cookieSessionActive = false;
let bearerTokenCache: string | null = null;

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function readStoredToken(): string | null {
  if (!canUseBrowserStorage()) return null;
  try {
    const raw = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    const value = String(raw || '').trim();
    return value || null;
  } catch {
    return null;
  }
}

function persistStoredToken(token: string | null): void {
  if (!canUseBrowserStorage()) return;
  try {
    if (token) window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // storage indisponivel nao deve quebrar auth
  }
}

function isCookieMarker(raw: string): boolean {
  const value = String(raw || '').trim().toLowerCase();
  return value === COOKIE_SESSION_TOKEN || value === 'cookie';
}

export function getToken(): string | null {
  if (!bearerTokenCache) {
    bearerTokenCache = readStoredToken();
  }
  if (bearerTokenCache) return bearerTokenCache;
  return cookieSessionActive ? COOKIE_SESSION_TOKEN : null;
}

export function setToken(token: string | null): void {
  const next = String(token || '').trim();
  if (!next) {
    bearerTokenCache = null;
    cookieSessionActive = false;
    persistStoredToken(null);
    return;
  }

  if (isCookieMarker(next)) {
    cookieSessionActive = true;
    return;
  }

  bearerTokenCache = next;
  cookieSessionActive = true;
  persistStoredToken(next);
}

export function clearToken(): void {
  setToken(null);
}

export function isCookieSessionToken(token: string | null | undefined): boolean {
  return token === COOKIE_SESSION_TOKEN;
}
