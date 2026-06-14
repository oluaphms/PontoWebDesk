// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const poolQuery = vi.fn();
const resolveCallerFromDb = vi.fn();
const tableHasColumn = vi.fn();

vi.mock('../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));

vi.mock('./callerContextService.js', () => ({
  resolveCallerFromDb: (...args: unknown[]) => resolveCallerFromDb(...args),
}));

vi.mock('../db/schemaColumns.js', () => ({
  tableHasColumn: (...args: unknown[]) => tableHasColumn(...args),
}));

import { resolveRepAdminCaller } from './repAdminAuthService.js';

function mockRes(): Response {
  return {} as Response;
}

describe('resolveRepAdminCaller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    tableHasColumn.mockResolvedValue(false);
  });

  it('rejeita usuário inexistente no banco', async () => {
    const token = jwt.sign(
      { sub: 'user-1', companyId: 'company-a', role: 'admin' },
      process.env.JWT_SECRET!,
    );
    resolveCallerFromDb.mockResolvedValue(null);

    const result = await resolveRepAdminCaller({
      headers: { authorization: `Bearer ${token}` },
    } as Request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('AUTH_USER_NOT_FOUND');
  });

  it('rejeita tenant divergente', async () => {
    const token = jwt.sign(
      { sub: 'user-1', companyId: 'company-a', role: 'admin' },
      process.env.JWT_SECRET!,
    );
    resolveCallerFromDb.mockResolvedValue({ userId: 'user-1', companyId: 'company-b', role: 'admin' });

    const result = await resolveRepAdminCaller({
      headers: { authorization: `Bearer ${token}` },
    } as Request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('AUTH_TENANT_CHANGED');
  });

  it('rejeita usuário invisível', async () => {
    const token = jwt.sign(
      { sub: 'user-1', companyId: 'company-a', role: 'admin' },
      process.env.JWT_SECRET!,
    );
    resolveCallerFromDb.mockResolvedValue({ userId: 'user-1', companyId: 'company-a', role: 'admin' });
    tableHasColumn.mockResolvedValue(true);
    poolQuery.mockResolvedValue({ rows: [{ invisivel: true }] });

    const result = await resolveRepAdminCaller({
      headers: { authorization: `Bearer ${token}` },
    } as Request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('AUTH_USER_INACTIVE');
  });

  it('aceita admin revalidado no banco', async () => {
    const token = jwt.sign(
      { sub: 'user-1', companyId: 'company-a', role: 'admin' },
      process.env.JWT_SECRET!,
    );
    resolveCallerFromDb.mockResolvedValue({ userId: 'user-1', companyId: 'company-a', role: 'admin' });

    const result = await resolveRepAdminCaller({
      headers: { authorization: `Bearer ${token}` },
    } as Request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.caller.companyId).toBe('company-a');
      expect(result.caller.userId).toBe('user-1');
    }
  });
});
