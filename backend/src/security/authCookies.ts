import type { Request, Response } from 'express';

export const AUTH_COOKIE_NAME = 'pwd_session';

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function authCookieSameSite(): 'lax' | 'strict' | 'none' {
  const defaultSameSite = isProduction() ? 'none' : 'lax';
  const raw = String(process.env.AUTH_COOKIE_SAMESITE || defaultSameSite).trim().toLowerCase();
  if (raw === 'strict' || raw === 'none') return raw;
  return 'lax';
}

/** Produção HTTPS: Secure=true. Local HTTP: Secure=false (AUTH_COOKIE_SECURE ou NODE_ENV=development). */
export function authCookieSecure(): boolean {
  const explicit = String(process.env.AUTH_COOKIE_SECURE || '').trim().toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;
  if (explicit === 'false' || explicit === '0') return false;
  return isProduction() || authCookieSameSite() === 'none';
}

function sameSite(): 'lax' | 'strict' | 'none' {
  return authCookieSameSite();
}

export function authCookieMaxAgeMs(): number {
  const raw = String(process.env.JWT_EXPIRES_IN || '').trim();
  const match = raw.match(/^(\d+)([smhd])$/i);
  if (!match) return 2 * 60 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor =
    unit === 's' ? 1000 :
      unit === 'm' ? 60 * 1000 :
        unit === 'h' ? 60 * 60 * 1000 :
          24 * 60 * 60 * 1000;
  return amount * factor;
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: authCookieSecure(),
    sameSite: sameSite(),
    path: '/',
    maxAge: authCookieMaxAgeMs(),
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: authCookieSecure(),
    sameSite: sameSite(),
    path: '/',
  });
}

export function getAuthCookie(req: Request): string | null {
  const raw = String(req.headers.cookie || '');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === AUTH_COOKIE_NAME) {
      return decodeURIComponent(rest.join('=') || '').trim() || null;
    }
  }
  return null;
}
