// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';

const resolveCallerFromDb = vi.fn();
const isTokenRevoked = vi.fn();
const readCompanySessionGate = vi.fn();
const clearAuthCookie = vi.fn();
const clearCsrfCookie = vi.fn();

vi.mock('../services/callerContextService.js', () => ({
  resolveCallerFromDb: (...args: unknown[]) => resolveCallerFromDb(...args),
}));

vi.mock('../services/tokenRevocationService.js', () => ({
  isTokenRevoked: (...args: unknown[]) => isTokenRevoked(...args),
}));

vi.mock('../master/commercial/companySessionRevocation.js', () => ({
  readCompanySessionGate: (...args: unknown[]) => readCompanySessionGate(...args),
  isCommercialGateUnavailableError: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'COMMERCIAL_GATE_UNAVAILABLE',
}));

vi.mock('../security/authCookies.js', () => ({
  getAuthCookie: () => null,
  clearAuthCookie: (...args: unknown[]) => clearAuthCookie(...args),
}));

vi.mock('../security/csrfCookies.js', () => ({
  clearCsrfCookie: (...args: unknown[]) => clearCsrfCookie(...args),
}));

import { authMiddleware, type AuthedRequest } from '../middlewares/authMiddleware.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('authMiddleware production hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    process.env.NODE_ENV = 'production';
    process.env.AUTH_REVALIDATE_DB = 'false';
    isTokenRevoked.mockResolvedValue(false);
    resolveCallerFromDb.mockResolvedValue({
      userId: 'user-1',
      companyId: 'company-a',
      role: 'admin',
    });
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: false,
      commercialBlockReason: null,
      companySessionVersion: 0,
    });
  });

  it('força revalidação no banco em produção mesmo com AUTH_REVALIDATE_DB=false', async () => {
    const token = jwt.sign(
      { sub: 'user-1', companyId: 'company-a', role: 'admin' },
      process.env.JWT_SECRET!,
    );
    const req = {
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      originalUrl: '/api/data/users',
    } as AuthedRequest;
    const next = vi.fn();

    await authMiddleware(req, mockRes(), next as NextFunction);

    expect(resolveCallerFromDb).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth?.companyId).toBe('company-a');
  });

  it('aceita companyId com diferença apenas de caixa entre JWT e banco', async () => {
    const companyUuid = '550e8400-e29b-41d4-a716-446655440000';
    resolveCallerFromDb.mockResolvedValue({
      userId: 'user-1',
      companyId: companyUuid.toUpperCase(),
      role: 'admin',
    });
    const token = jwt.sign(
      { sub: 'user-1', companyId: companyUuid.toLowerCase(), role: 'admin' },
      process.env.JWT_SECRET!,
    );
    const req = {
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      originalUrl: '/api/auth/me',
    } as AuthedRequest;
    const next = vi.fn();

    await authMiddleware(req, mockRes(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('retorna 401 COMMERCIAL_BLOCKED_BY_MASTER e limpa cookies quando empresa está bloqueada', async () => {
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: true,
      commercialBlockReason: 'license_blocked_by_master',
      companySessionVersion: 2,
    });
    const token = jwt.sign(
      { sub: 'user-1', companyId: 'company-a', role: 'admin', companySessionVersion: 2 },
      process.env.JWT_SECRET!,
    );
    const req = {
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      originalUrl: '/api/auth/me',
    } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as { code?: string }).code).toBe('COMMERCIAL_BLOCKED_BY_MASTER');
    expect(clearAuthCookie).toHaveBeenCalled();
    expect(clearCsrfCookie).toHaveBeenCalled();
  });

  it('falha fechado com 503 quando o gate comercial está indisponível', async () => {
    readCompanySessionGate.mockRejectedValue(
      Object.assign(new Error('gate unavailable'), {
        code: 'COMMERCIAL_GATE_UNAVAILABLE',
      }),
    );
    const token = jwt.sign(
      { sub: 'user-1', companyId: 'company-a', role: 'admin' },
      process.env.JWT_SECRET!,
    );
    const req = {
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      originalUrl: '/api/data/users',
    } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect((res.body as { code?: string }).code).toBe('COMMERCIAL_GATE_UNAVAILABLE');
  });

  it('GET /auth/me sem token responde 200 AUTH_MISSING_TOKEN (probe neutro)', async () => {
    const req = {
      headers: {},
      method: 'GET',
      originalUrl: '/api/auth/me',
    } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect((res.body as { code?: string; user?: unknown }).code).toBe('AUTH_MISSING_TOKEN');
    expect((res.body as { user?: unknown }).user).toBeNull();
  });

  it('outras rotas sem token continuam 401 AUTH_MISSING_TOKEN', async () => {
    const req = {
      headers: {},
      method: 'GET',
      originalUrl: '/api/data/users',
    } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as { code?: string }).code).toBe('AUTH_MISSING_TOKEN');
  });

  it('revoga JWT com companySessionVersion antiga após bump de bloqueio', async () => {
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: false,
      commercialBlockReason: null,
      companySessionVersion: 3,
    });
    const token = jwt.sign(
      { sub: 'user-1', companyId: 'company-a', role: 'admin', companySessionVersion: 1 },
      process.env.JWT_SECRET!,
    );
    const req = {
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      originalUrl: '/api/data/companies',
    } as AuthedRequest;
    const res = mockRes();
    const next = vi.fn();

    await authMiddleware(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as { code?: string }).code).toBe('AUTH_TOKEN_REVOKED');
  });

  it('empresa ativa com JWT legado sem companySessionVersion continua válida', async () => {
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: false,
      commercialBlockReason: null,
      companySessionVersion: 0,
    });
    const token = jwt.sign(
      { sub: 'user-1', companyId: 'company-a', role: 'admin' },
      process.env.JWT_SECRET!,
    );
    const req = {
      headers: { authorization: `Bearer ${token}` },
      method: 'GET',
      originalUrl: '/api/auth/me',
    } as AuthedRequest;
    const next = vi.fn();

    await authMiddleware(req, mockRes(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
