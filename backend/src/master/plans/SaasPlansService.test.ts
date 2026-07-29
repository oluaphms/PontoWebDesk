// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { addPlanCycle, SaasPlansService } from './SaasPlansService.js';
import type { MasterSqlQuery } from '../adapters/postgres/masterSql.js';

describe('Fase 6.3 — ciclos de planos SaaS', () => {
  it('mensal preserva o dia e limita ao último dia do mês', () => {
    expect(addPlanCycle('2024-01-31T12:00:00.000Z', 'MONTHLY')).toBe('2024-02-29T12:00:00.000Z');
    expect(addPlanCycle('2025-01-31T12:00:00.000Z', 'MONTHLY')).toBe('2025-02-28T12:00:00.000Z');
  });

  it('anual adiciona exatamente 12 meses', () => {
    expect(addPlanCycle('2026-07-21T10:00:00.000Z', 'ANNUAL')).toBe('2027-07-21T10:00:00.000Z');
  });

  it('cria plano com limites, módulos e ciclo canônico', async () => {
    const sql = vi.fn(async (_query: string, values: unknown[] = []) => ({
      rows: [{
        id: values[0], name: values[1], cycle: values[2], price_cents: values[3],
        employee_limit: values[4], user_limit: values[5], enabled_modules: values[6],
        active: values[7], created_at: '2026-07-21T00:00:00.000Z', updated_at: '2026-07-21T00:00:00.000Z',
      }],
      rowCount: 1, command: 'INSERT', oid: 0, fields: [],
    })) as unknown as MasterSqlQuery;
    const service = new SaasPlansService(sql);

    const plan = await service.createPlan({
      name: 'Pro Anual', cycle: 'ANNUAL', priceCents: 199000,
      employeeLimit: 100, userLimit: 10, enabledModules: ['PONTO', 'RH', 'PONTO'],
    });

    expect(plan.cycle).toBe('ANNUAL');
    expect(plan.priceCents).toBe(199000);
    expect(plan.enabledModules).toEqual(['PONTO', 'RH']);
  });

  it('atribui plano à empresa e calcula vencimento mensal', async () => {
    const planRow = {
      id: 'plan-pro', name: 'Pro', cycle: 'MONTHLY', price_cents: 19900,
      employee_limit: 100, user_limit: 10, enabled_modules: ['PONTO'], active: true,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    };
    const sql: MasterSqlQuery = async <R extends QueryResultRow = QueryResultRow>(query: string, values: unknown[] = []): Promise<QueryResult<R>> => {
      let rows: unknown[] = [];
      if (query.includes('FROM public.master_tenants') && !query.includes('JOIN')) {
        rows = [{
          id: 'tn-1',
          operational_company_id: 'co-1',
          company_name: 'Acme',
          admin_user_id: 'u-1',
          installation_type: 'SAAS_WEB',
          mode: 'SAAS',
        }];
      } else if (query.includes('FROM public.master_subscriptions s') && query.includes('LIMIT 1')) {
        rows = [];
      } else if (query.includes('FROM public.master_plans WHERE id')) {
        rows = [planRow];
      } else if (query.includes('WITH cancelled AS')) {
        rows = [{
          id: values[1], tenant_id: values[2], company_id: values[4], plan_id: values[5],
          plan_name: values[14], cycle: values[8], starts_at: values[11], expires_at: values[12],
          status: values[7], amount_cents: values[10], created_at: values[11], updated_at: values[11],
          cancelled_at: null, company_name: values[15],
        }];
      }
      return { rows: rows as R[], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
    };
    const service = new SaasPlansService(sql);
    const assigned = await service.assignPlan({
      companyId: 'co-1', planId: 'plan-pro', status: 'ACTIVE', startsAt: '2026-01-31T12:00:00.000Z',
    });

    expect(assigned.companyId).toBe('co-1');
    expect(assigned.planId).toBe('plan-pro');
    expect(assigned.expiresAt).toBe('2026-02-28T12:00:00.000Z');
    expect(assigned.status).toBe('ACTIVE');
  });

  it('rejeita plano anual para empresa SAAS_WEB', async () => {
    const planRow = {
      id: 'plan-anual', name: 'Pro', cycle: 'ANNUAL', price_cents: 199000,
      employee_limit: 100, user_limit: 10, enabled_modules: ['PONTO'], active: true,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    };
    const sql: MasterSqlQuery = async <R extends QueryResultRow = QueryResultRow>(query: string): Promise<QueryResult<R>> => {
      let rows: unknown[] = [];
      if (query.includes('FROM public.master_tenants') && !query.includes('JOIN')) {
        rows = [{
          id: 'tn-1', operational_company_id: 'co-1', company_name: 'Acme',
          admin_user_id: 'u-1', installation_type: 'SAAS_WEB', mode: 'SAAS',
        }];
      } else if (query.includes('FROM public.master_subscriptions s') && query.includes('LIMIT 1')) {
        rows = [];
      } else if (query.includes('FROM public.master_plans WHERE id')) {
        rows = [planRow];
      }
      return { rows: rows as R[], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
    };
    const service = new SaasPlansService(sql);
    await expect(
      service.assignPlan({ companyId: 'co-1', planId: 'plan-anual', status: 'ACTIVE' }),
    ).rejects.toThrow(/mensal/i);
  });
});
