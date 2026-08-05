/**
 * MasterJWT — emissão/verificação do JWT do Painel Master.
 * Usa apenas MASTER_JWT_SECRET (nunca JWT_SECRET das empresas).
 */
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { MasterAuthContext, MasterRole } from './masterAuth.types.js';
import { getMasterAccessTtl, getMasterAccessTtlMs } from './masterSessionConfig.js';

/** Payload canônico do JWT Master (enterprise). */
export type MasterJWT = {
  typ: 'master';
  sub: string;
  email: string;
  name: string;
  role: MasterRole;
  /** JWT ID — revogação / unicidade. */
  jti: string;
  /** Sessão server-side. */
  sessionId: string;
  /** ISO 8601 — emissão. */
  issuedAt: string;
  /** ISO 8601 — última atividade conhecida no momento da emissão. */
  lastActivity: string;
  device?: string | null;
  ip?: string | null;
};

/** @deprecated Prefer MasterJWT. */
export type MasterTokenPayload = MasterJWT;

function masterSecret(): string {
  const dedicated = String(process.env.MASTER_JWT_SECRET || '').trim();
  if (dedicated) {
    if (
      process.env.NODE_ENV === 'production' &&
      (dedicated.length < 32 || /(?:change[-_ ]?me|generate[-_ ]|placeholder)/i.test(dedicated))
    ) {
      throw new Error('MASTER_JWT_SECRET inseguro para produção.');
    }
    return dedicated;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('MASTER_JWT_SECRET obrigatório em produção.');
  }
  const dev = String(process.env.MASTER_DEV_SECRET || 'master-dev-secret-change-me').trim();
  return dev;
}

export function getMasterTokenTtl(): string {
  return getMasterAccessTtl();
}

export function getMasterTokenTtlMs(): number {
  return getMasterAccessTtlMs();
}

export function newMasterJti(): string {
  return `mjti_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function signMasterToken(input: {
  userId: string;
  email: string;
  name: string;
  role: MasterRole;
  sessionId: string;
  jti?: string;
  issuedAt?: string;
  lastActivity?: string;
  device?: string | null;
  ip?: string | null;
}): { token: string; expiresAt: string; jti: string; issuedAt: string } {
  const issuedAt = input.issuedAt || new Date().toISOString();
  const lastActivity = input.lastActivity || issuedAt;
  const jti = input.jti || newMasterJti();
  const payload: MasterJWT = {
    typ: 'master',
    sub: input.userId,
    email: input.email,
    name: input.name,
    role: input.role,
    jti,
    sessionId: input.sessionId,
    issuedAt,
    lastActivity,
    device: input.device ?? null,
    ip: input.ip ?? null,
  };
  const token = jwt.sign(payload, masterSecret(), {
    expiresIn: getMasterTokenTtl(),
    audience: 'pontowebdesk-master',
    issuer: 'pontowebdesk-master-auth',
  } as jwt.SignOptions);

  const decoded = jwt.decode(token) as { exp?: number } | null;
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000).toISOString()
    : new Date(Date.now() + getMasterTokenTtlMs()).toISOString();
  return { token, expiresAt, jti, issuedAt };
}

export function verifyMasterToken(token: string): MasterAuthContext | null {
  try {
    const decoded = jwt.verify(token, masterSecret(), {
      algorithms: ['HS256'],
      audience: 'pontowebdesk-master',
      issuer: 'pontowebdesk-master-auth',
    }) as MasterJWT & { jti?: string };
    if (decoded.typ !== 'master' || !decoded.sub || !decoded.role) return null;
    const jti = decoded.jti || (decoded as { jti?: string }).jti;
    if (!jti || !decoded.sessionId) return null;
    return {
      userId: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      jti,
      sessionId: decoded.sessionId,
      issuedAt: decoded.issuedAt,
      lastActivity: decoded.lastActivity,
      device: decoded.device ?? null,
      ip: decoded.ip ?? null,
    };
  } catch {
    return null;
  }
}

/** Decodifica sem verificar (somente inspeção). */
export function decodeMasterJWT(token: string): (MasterJWT & { exp?: number; iat?: number }) | null {
  try {
    const decoded = jwt.decode(token) as (MasterJWT & { exp?: number; iat?: number }) | null;
    if (!decoded || decoded.typ !== 'master') return null;
    return decoded;
  } catch {
    return null;
  }
}

export const MASTER_AUTH_HEADER = 'authorization';
/** Cookie exclusivo Master (access) — não é pwd_session das empresas. */
export const MASTER_AUTH_COOKIE = 'pwd_master_session';
/** Cookie exclusivo Master (refresh) — nunca compartilhado com empresas. */
export const MASTER_REFRESH_COOKIE = 'pwd_master_refresh';

/** Alias explícito do módulo. */
export const MasterJWTModule = {
  sign: signMasterToken,
  verify: verifyMasterToken,
  decode: decodeMasterJWT,
  cookieName: MASTER_AUTH_COOKIE,
  refreshCookieName: MASTER_REFRESH_COOKIE,
  getTtl: getMasterTokenTtl,
  getTtlMs: getMasterTokenTtlMs,
  newJti: newMasterJti,
};
