/**
 * Cookies da sessão Master — isolados de authCookies (pwd_session).
 * Access: pwd_master_session | Refresh: pwd_master_refresh
 * Nunca toca cookies das empresas.
 */
import type { Response } from 'express';
import {
  MASTER_AUTH_COOKIE,
  MASTER_REFRESH_COOKIE,
  getMasterTokenTtlMs,
} from './MasterJWT.js';
import { getMasterRefreshTtlMs } from './masterSessionConfig.js';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function masterCookieSecure(): boolean {
  const explicit = String(process.env.MASTER_COOKIE_SECURE || '').trim().toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;
  if (explicit === 'false' || explicit === '0') return false;
  return isProduction();
}

function masterCookieSameSite(): 'Lax' | 'Strict' | 'None' {
  const raw = String(process.env.MASTER_COOKIE_SAMESITE || (isProduction() ? 'none' : 'lax'))
    .trim()
    .toLowerCase();
  if (raw === 'strict') return 'Strict';
  if (raw === 'none') return 'None';
  return 'Lax';
}

/** Path restrito à API Master — não colide com pwd_session. */
export const MASTER_COOKIE_PATH = '/api/master';

function buildCookie(name: string, value: string, maxAgeSec: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${MASTER_COOKIE_PATH}`,
    'HttpOnly',
    `SameSite=${masterCookieSameSite()}`,
    `Max-Age=${Math.max(0, maxAgeSec)}`,
  ];
  if (masterCookieSecure() || masterCookieSameSite() === 'None') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/** Grava access JWT em pwd_master_session (nunca pwd_session). */
export function setMasterSessionCookie(res: Response, token: string): void {
  const maxAgeSec = Math.floor(getMasterTokenTtlMs() / 1000);
  res.append('Set-Cookie', buildCookie(MASTER_AUTH_COOKIE, token, maxAgeSec));
}

/** Grava refresh token em pwd_master_refresh. */
export function setMasterRefreshCookie(res: Response, refreshToken: string): void {
  const maxAgeSec = Math.floor(getMasterRefreshTtlMs() / 1000);
  res.append('Set-Cookie', buildCookie(MASTER_REFRESH_COOKIE, refreshToken, maxAgeSec));
}

/** Limpa apenas cookies Master (access + refresh). */
export function clearMasterSessionCookie(res: Response): void {
  res.append('Set-Cookie', buildCookie(MASTER_AUTH_COOKIE, '', 0));
  res.append('Set-Cookie', buildCookie(MASTER_REFRESH_COOKIE, '', 0));
}

/** Alias explícito. */
export function clearMasterRefreshCookie(res: Response): void {
  res.append('Set-Cookie', buildCookie(MASTER_REFRESH_COOKIE, '', 0));
}
