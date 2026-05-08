import { describe, it, expect } from 'vitest';
import { assertPlanLimit, PlanLimitError, PLAN_LIMIT_CODE } from './planEnforcement';
import { installOperationalTestIsolation } from '../src/testing/operationalTestIsolation';

/** Mock mínimo da cadeia Supabase usada por assertPlanLimit */
function mockClient(opts: { plan: string; activeEmployeeCount: number }) {
  return {
    from(table: string) {
      if (table === 'companies') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { plan: opts.plan }, error: null }),
            }),
          }),
        };
      }
      if (table === 'users') {
        return {
          select: (_sel: string, _opt?: { count?: string; head?: boolean }) => ({
            eq: () => ({
              eq: () => ({
                eq: async () => ({ count: opts.activeEmployeeCount, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

describe('assertPlanLimit', () => {
  installOperationalTestIsolation();

  it('permite CREATE_EMPLOYEE no Free mesmo com 5 ativos (plano sem limite hard)', async () => {
    const client = mockClient({ plan: 'free', activeEmployeeCount: 5 }) as any;
    await expect(
      assertPlanLimit(client, { tenantId: 't1', action: { type: 'CREATE_EMPLOYEE' } }),
    ).resolves.toBeUndefined();
  });

  it('permite CREATE_EMPLOYEE no Free com vaga', async () => {
    const client = mockClient({ plan: 'free', activeEmployeeCount: 4 }) as any;
    await expect(
      assertPlanLimit(client, { tenantId: 't1', action: { type: 'CREATE_EMPLOYEE' } }),
    ).resolves.toBeUndefined();
  });

  it('permite USE_REP rep_afd_import no Free (feature liberada)', async () => {
    const client = mockClient({ plan: 'free', activeEmployeeCount: 0 }) as any;
    await expect(
      assertPlanLimit(client, {
        tenantId: 't1',
        action: { type: 'USE_REP', feature: 'rep_afd_import' },
      }),
    ).resolves.toBeUndefined();
  });

  it('permite USE_REP no Pro', async () => {
    const client = mockClient({ plan: 'pro', activeEmployeeCount: 0 }) as any;
    await expect(
      assertPlanLimit(client, {
        tenantId: 't1',
        action: { type: 'USE_REP', feature: 'rep_devices' },
      }),
    ).resolves.toBeUndefined();
  });

  it('falha sem tenant_id', async () => {
    const client = mockClient({ plan: 'pro', activeEmployeeCount: 0 }) as any;
    await expect(assertPlanLimit(client, { tenantId: '', action: { type: 'CREATE_EMPLOYEE' } })).rejects.toMatchObject({
      code: PLAN_LIMIT_CODE,
    });
    await expect(assertPlanLimit(client, { tenantId: '', action: { type: 'CREATE_EMPLOYEE' } })).rejects.toBeInstanceOf(
      PlanLimitError,
    );
  });
});
