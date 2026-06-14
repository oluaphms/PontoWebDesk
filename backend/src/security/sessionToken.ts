/** Marcador do frontend quando a sessão está só no cookie HttpOnly (não é JWT). */
const COOKIE_SESSION_MARKERS = new Set(['__http_only_cookie_session__', 'cookie']);

export function isCookieSessionMarker(token: string | null | undefined): boolean {
  const value = String(token || '').trim().toLowerCase();
  return COOKIE_SESSION_MARKERS.has(value);
}

/** Prioriza Bearer JWT válido; ignora marcador de cookie e usa pwd_session. */
export function resolveAuthToken(bearer: string | null | undefined, cookie: string | null | undefined): string | null {
  const bearerTrim = String(bearer || '').trim();
  if (bearerTrim && !isCookieSessionMarker(bearerTrim)) return bearerTrim;
  const cookieTrim = String(cookie || '').trim();
  return cookieTrim || null;
}
