import { describe, expect, it } from 'vitest';
import { isAdminOrHr, normalizeRole, rejectTenantOverride } from './authContext.js';

describe('authContext', () => {
  it('isAdminOrHr', () => {
    expect(isAdminOrHr('admin')).toBe(true);
    expect(isAdminOrHr('administrador')).toBe(true);
    expect(isAdminOrHr('hr')).toBe(true);
    expect(isAdminOrHr('employee')).toBe(false);
  });

  it('normalizeRole', () => {
    expect(normalizeRole('  HR ')).toBe('hr');
    expect(normalizeRole('gestor')).toBe('supervisor');
    expect(normalizeRole('funcionário')).toBe('employee');
  });

  it('rejectTenantOverride detects mismatch', () => {
    const res = { status: () => ({ json: (b: unknown) => b }) };
    const req = {
      auth: { companyId: 'c1', sub: 'u1' },
      query: { companyId: 'c2' },
      body: {},
    } as unknown as Parameters<typeof rejectTenantOverride>[0];
    const blocked = rejectTenantOverride(req, res as never);
    expect(blocked).toBe(true);
  });
});
