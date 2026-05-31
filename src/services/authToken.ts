const COOKIE_SESSION_TOKEN = '__http_only_cookie_session__';

let cookieSessionActive = false;

export function getToken(): string | null {
  return cookieSessionActive ? COOKIE_SESSION_TOKEN : null;
}

export function setToken(token: string | null): void {
  cookieSessionActive = Boolean(token);
}

export function clearToken(): void {
  setToken(null);
}

export function isCookieSessionToken(token: string | null | undefined): boolean {
  return token === COOKIE_SESSION_TOKEN;
}
