import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { authCookieSameSite, authCookieSecure } from './authCookies.js';

export const CSRF_COOKIE_NAME = 'pwd_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: authCookieSecure(),
    sameSite: authCookieSameSite(),
    path: '/',
    maxAge: 2 * 60 * 60 * 1000,
  });
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: authCookieSecure(),
    sameSite: authCookieSameSite(),
    path: '/',
  });
}

export function getCsrfCookie(req: Request): string | null {
  const raw = String(req.headers.cookie || '');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(rest.join('=') || '').trim() || null;
    }
  }
  return null;
}
