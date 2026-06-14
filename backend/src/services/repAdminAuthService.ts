import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/index.js';
import { tableHasColumn } from '../db/schemaColumns.js';
import type { JwtPayload } from '../middlewares/authMiddleware.js';
import { getAuthCookie } from '../security/authCookies.js';
import { resolveAuthToken } from '../security/sessionToken.js';
import { isAdminOrHr } from '../utils/authContext.js';
import { resolveCallerFromDb } from './callerContextService.js';

export type RepAdminCaller = {
  userId: string;
  companyId: string;
  role: string;
};

export type RepAdminAuthCode =
  | 'AUTH_USER_NOT_FOUND'
  | 'AUTH_TENANT_CHANGED'
  | 'AUTH_USER_INACTIVE'
  | 'unauthorized'
  | 'invalid_token';

export type RepAdminAuthFailure = {
  status: number;
  code: RepAdminAuthCode;
};

function extractAdminToken(req: Request): string {
  const raw = String(req.headers.authorization || '').trim();
  const bearer = raw.replace(/^Bearer\s+/i, '').trim();
  return resolveAuthToken(bearer, getAuthCookie(req)) || '';
}

/** Revalida JWT admin/hr REP no banco — equivalente ao authMiddleware para rotas REP. */
export async function resolveRepAdminCaller(
  req: Request,
): Promise<{ ok: true; caller: RepAdminCaller } | { ok: false; failure: RepAdminAuthFailure }> {
  const secret = String(process.env.JWT_SECRET || '').trim();
  const token = extractAdminToken(req);
  if (!secret || !token) {
    return { ok: false, failure: { status: 401, code: 'unauthorized' } };
  }

  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, secret) as JwtPayload;
  } catch {
    return { ok: false, failure: { status: 401, code: 'invalid_token' } };
  }

  const caller = await resolveCallerFromDb(decoded);
  if (!caller?.companyId) {
    return { ok: false, failure: { status: 401, code: 'AUTH_USER_NOT_FOUND' } };
  }

  const tokenCompanyId = String(decoded.companyId || '').trim();
  if (tokenCompanyId && caller.companyId !== tokenCompanyId) {
    return { ok: false, failure: { status: 401, code: 'AUTH_TENANT_CHANGED' } };
  }

  if (!isAdminOrHr(caller.role)) {
    return { ok: false, failure: { status: 401, code: 'unauthorized' } };
  }

  if (await tableHasColumn('users', 'invisivel')) {
    const visibility = await pool.query(
      `select coalesce(invisivel, false) as invisivel
         from public.users
        where id::text = $1
        limit 1`,
      [caller.userId],
    );
    if (visibility.rows[0]?.invisivel === true) {
      return { ok: false, failure: { status: 401, code: 'AUTH_USER_INACTIVE' } };
    }
  }

  return { ok: true, caller };
}
