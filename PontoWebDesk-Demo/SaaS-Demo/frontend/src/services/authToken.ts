import { clearCsrfToken } from './csrfToken';
import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { bumpAuthSessionEpoch } from './authSessionEpoch';

const COOKIE_SESSION_TOKEN = '__http_only_cookie_session__';
const AUTH_TOKEN_STORAGE_KEY = 'pwd_auth_token';
const LEGACY_AUTH_TOKEN_STORAGE_KEYS = ['token'] as const;

let cookieSessionActive = false;
/** Bearer em memória volátil — nunca persiste em localStorage (mitiga XSS). */
let bearerTokenCache: string | null = null;

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function clearLegacyStoredTokens(): void {
  if (!canUseBrowserStorage()) return;
  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    for (const key of LEGACY_AUTH_TOKEN_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // storage indisponivel nao deve quebrar auth
  }
}

function isCookieMarker(raw: string): boolean {
  const value = String(raw || '').trim().toLowerCase();
  return value === COOKIE_SESSION_TOKEN || value === 'cookie';
}

export function getToken(): string | null {
  if (bearerTokenCache) return bearerTokenCache;
  return cookieSessionActive ? COOKIE_SESSION_TOKEN : null;
}

export function setToken(token: string | null): void {
  const next = String(token || '').trim();
  if (!next) {
    const hadSession = Boolean(bearerTokenCache) || cookieSessionActive;
    bearerTokenCache = null;
    cookieSessionActive = false;
    clearLegacyStoredTokens();
    clearCsrfToken();
    if (hadSession) bumpAuthSessionEpoch('token_cleared');
    return;
  }

  if (isCookieMarker(next)) {
    const wasCookieOnly = cookieSessionActive && !bearerTokenCache;
    cookieSessionActive = true;
    clearLegacyStoredTokens();
    if (!wasCookieOnly) bumpAuthSessionEpoch('token_saved_cookie');
    observabilityConsole.info('[AUTH-FLOW] TOKEN SAVED', { mode: 'cookie' });
    return;
  }

  const prevBearer = bearerTokenCache;
  bearerTokenCache = next;
  cookieSessionActive = true;
  clearLegacyStoredTokens();
  if (prevBearer !== next) bumpAuthSessionEpoch('token_saved_bearer');
  observabilityConsole.info('[AUTH-FLOW] TOKEN SAVED', { mode: 'bearer' });
}

export function clearToken(): void {
  observabilityConsole.info('[AUTH-FLOW] TOKEN REMOVED', { source: 'authToken.clearToken' });
  setToken(null);
}

export function isCookieSessionToken(token: string | null | undefined): boolean {
  return token === COOKIE_SESSION_TOKEN;
}

clearLegacyStoredTokens();
