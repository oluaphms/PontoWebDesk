// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';

const resolveCallerFromDb = vi.fn();
const isTokenRevoked = vi.fn();

vi.mock('../services/callerContextService.js', () => ({
  resolveCallerFromDb: (...args: unknown[]) => resolveCallerFromDb(...args),
}));

vi.mock('../services/tokenRevocationService.js', () => ({
  isTokenRevoked: (...args: unknown[]) => isTokenRevoked(...args),
}));

vi.mock('../security/authCookies.js', () => ({
  getAuthCookie: () => null,
}));

import { authMiddleware, type AuthedRequest } from '../middlewares/authMiddleware.js';

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

    await authMiddleware(req, {} as Response, next as NextFunction);

    expect(resolveCallerFromDb).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth?.companyId).toBe('company-a');
  });
});
