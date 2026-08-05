// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMaster = vi.fn();

vi.mock('../../db/index.js', () => ({
  pool: {
    queryMaster: (...args: unknown[]) => queryMaster(...args),
  },
}));

import { projectCommercialStateToSaas } from './CommercialProjectionService.js';
import type { ManagedTenant } from '../tenantManager/tenantManager.types.js';

function tenant(status: ManagedTenant['status'] = 'blocked'): ManagedTenant {
  return {
    id: 'tn-1',
    operationalCompanyId: 'company-1',
    plan: 'PRO',
    status,
    mode: 'SAAS',
    gateway: 'none',
    installationType: 'SAAS_WEB',
    license: {},
    company: { name: 'Empresa Teste' },
    admin: { name: 'Admin', email: 'admin@test.local' },
    domain: 'empresa.test',
    storage: { driver: 'none' },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
  };
}

describe('Fase 6.2 — projeção obrigatória do bloqueio administrativo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMaster.mockImplementation(async (sql: string) => {
      if (sql.includes('select id::text as id')) {
        return { rowCount: 1, rows: [{ id: 'company-1' }] };
      }
      if (sql.includes('select commercial_revision')) {
        return { rowCount: 1, rows: [{ commercial_revision: 3 }] };
      }
      if (sql.includes('update public.companies')) {
        return { rowCount: 1, rows: [{ id: 'company-1' }] };
      }
      return { rowCount: 0, rows: [] };
    });
  });

  it('bloqueia e incrementa a versão de sessão na mesma operação SQL', async () => {
    const result = await projectCommercialStateToSaas(
      { tenant: tenant('blocked') },
      { required: true },
    );

    expect(result?.commercialBlocked).toBe(true);
    const updateSql = String(
      queryMaster.mock.calls.find(([sql]) =>
        String(sql).includes('update public.companies'),
      )?.[0] ?? '',
    );
    expect(updateSql).toContain('commercial_blocked = $10');
    expect(updateSql).toContain('company_session_version = case');
    expect(updateSql).toContain('commercial_blocked is distinct from true');
  });

  it('rejeita a ação quando a empresa operacional não existe', async () => {
    queryMaster.mockImplementation(async (sql: string) => {
      if (sql.includes('select id::text as id')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    await expect(
      projectCommercialStateToSaas(
        { tenant: tenant('blocked') },
        { required: true },
      ),
    ).rejects.toThrow('COMMERCIAL_PROJECTION_COMPANY_NOT_FOUND');
  });

  it('não apaga nem altera dados operacionais fora dos campos comerciais', async () => {
    await projectCommercialStateToSaas(
      { tenant: tenant('blocked') },
      { required: true },
    );
    const updateSql = String(
      queryMaster.mock.calls.find(([sql]) =>
        String(sql).includes('update public.companies'),
      )?.[0] ?? '',
    ).toLowerCase();

    expect(updateSql).not.toContain('delete ');
    expect(updateSql).not.toContain('truncate ');
    expect(updateSql).not.toContain('from public.users');
    expect(updateSql).not.toContain('from public.employees');
    expect(updateSql).not.toContain('from public.time_records');
  });
});
