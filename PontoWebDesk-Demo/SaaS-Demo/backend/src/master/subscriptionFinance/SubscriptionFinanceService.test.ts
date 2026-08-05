// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { MasterSqlQuery } from '../adapters/postgres/masterSql.js';
import { SubscriptionFinanceService } from './SubscriptionFinanceService.js';
import { processSubscriptionOverdues } from './SubscriptionFinanceAutomation.js';
import type { SubscriptionFinanceEntry } from './subscriptionFinance.types.js';

function result<R extends QueryResultRow>(rows: R[]): QueryResult<R> {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

describe('Fase 6.4 — financeiro da assinatura', () => {
  it('cria cobrança com preço e datas editáveis e bloqueio padrão em 7 dias', async () => {
    const sql: MasterSqlQuery = async <R extends QueryResultRow = QueryResultRow>(
      query: string,
      values: unknown[] = [],
    ): Promise<QueryResult<R>> => {
      if (query.includes('FROM public.master_subscriptions s')) {
        return result([{
          id: 'sub-1',
          tenant_id: 'tn-1',
          company_id: 'co-1',
          amount_cents: 14900,
          cycle: 'MONTHLY',
          company_name: 'Acme',
        }] as unknown as R[]);
      }
      if (query.includes('INSERT INTO public.master_subscription_finance_entries')) {
        return result([{
          id: values[0],
          subscription_id: values[1],
          tenant_id: values[2],
          company_id: values[3],
          company_name: values[12],
          kind: 'PAYMENT',
          status: values[4],
          amount_cents: values[5],
          currency: 'BRL',
          due_at: values[6],
          block_at: values[7],
          paid_at: values[8],
          event_at: values[6],
          description: values[9],
          source_entry_id: null,
          automatic: false,
          created_by_master_user_id: values[10],
          created_at: values[6],
          updated_at: values[6],
          meta: {},
        }] as unknown as R[]);
      }
      return result([]);
    };
    const service = new SubscriptionFinanceService(sql);

    const entry = await service.createPayment({
      companyId: 'co-1',
      amountCents: 14900,
      dueAt: '2026-08-21T12:00:00.000Z',
      actorUserId: 'master-1',
    });

    expect(entry.amountCents).toBe(14900);
    expect(entry.dueAt).toBe('2026-08-21T12:00:00.000Z');
    expect(entry.blockAt).toBe('2026-08-28T12:00:00.000Z');
    expect(entry.status).toBe('PENDING');
  });

  it('marca pendências vencidas e seleciona somente datas de bloqueio atingidas', async () => {
    const calls: string[] = [];
    const sql: MasterSqlQuery = async <R extends QueryResultRow = QueryResultRow>(
      query: string,
    ): Promise<QueryResult<R>> => {
      calls.push(query);
      if (query.includes("e.block_at <= $1")) {
        return result([{
          id: 'fin-1',
          subscription_id: 'sub-1',
          tenant_id: 'tn-1',
          company_id: 'co-1',
          company_name: 'Acme',
          kind: 'PAYMENT',
          status: 'OVERDUE',
          amount_cents: 14900,
          currency: 'BRL',
          due_at: '2026-08-21T12:00:00.000Z',
          block_at: '2026-08-28T12:00:00.000Z',
          paid_at: null,
          event_at: '2026-08-21T12:00:00.000Z',
          description: 'Mensalidade',
          source_entry_id: null,
          automatic: false,
          created_by_master_user_id: 'master-1',
          created_at: '2026-08-21T12:00:00.000Z',
          updated_at: '2026-08-28T12:00:00.000Z',
          meta: {},
        }] as unknown as R[]);
      }
      return result([]);
    };
    const service = new SubscriptionFinanceService(sql);

    const candidates = await service.claimAutomaticBlockCandidates('2026-08-28T12:00:01.000Z');

    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe('OVERDUE');
    expect(calls.some((query) => query.includes("SET status='OVERDUE'"))).toBe(true);
  });

  it('bloqueia pelo serviço oficial e registra auditoria do sistema', async () => {
    const source: SubscriptionFinanceEntry = {
      id: 'fin-overdue',
      subscriptionId: 'sub-1',
      tenantId: 'tn-1',
      companyId: 'co-1',
      companyName: 'Acme',
      kind: 'PAYMENT',
      status: 'OVERDUE',
      amountCents: 14900,
      currency: 'BRL',
      dueAt: '2026-08-21T12:00:00.000Z',
      blockAt: '2026-08-28T12:00:00.000Z',
      paidAt: null,
      eventAt: '2026-08-21T12:00:00.000Z',
      description: 'Mensalidade',
      sourceEntryId: null,
      automatic: false,
      createdByMasterUserId: 'master-1',
      createdAt: '2026-08-21T12:00:00.000Z',
      updatedAt: '2026-08-28T12:00:00.000Z',
      meta: {},
    };
    const applyAction = vi.fn(async () => ({
      id: 'tn-1',
      status: 'blocked',
      meta: { lastActionReason: 'subscription_overdue:fin-overdue' },
    }));
    const append = vi.fn(async (input: unknown) => input);
    const recordAutomaticBlock = vi.fn(async () => ({
      ...source,
      id: 'fin-block',
      kind: 'AUTOMATIC_BLOCK' as const,
      status: 'BLOCKED' as const,
      amountCents: null,
      sourceEntryId: source.id,
      automatic: true,
    }));

    const notifyBlocked = vi.fn(async () => [{ id: 'ntf-1' }]);
    const summary = await processSubscriptionOverdues({
      finance: {
        claimAutomaticBlockCandidates: vi.fn(async () => [source]),
        recordAutomaticBlock,
      } as unknown as SubscriptionFinanceService,
      tenants: {
        get: vi.fn(async () => ({ id: 'tn-1', status: 'active', meta: {} })),
        applyAction,
      } as never,
      audit: { append } as never,
      notifications: { notifyBlocked } as never,
      sql: (async () => ({ rows: [{ admin_email: 'admin@acme.test' }] })) as never,
    });

    expect(summary).toEqual({ scanned: 1, blocked: 1, skipped: 0, failed: 0, notified: 1 });
    expect(applyAction).toHaveBeenCalledWith(
      'tn-1',
      'block',
      { reason: 'subscription_overdue:fin-overdue' },
    );
    expect(notifyBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ financeEntryId: 'fin-overdue', adminEmail: 'admin@acme.test' }),
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUBSCRIPTION_AUTO_BLOCKED', companyId: 'co-1' }),
    );
  });

  it('não sobrescreve bloqueio administrativo existente', async () => {
    const source = { id: 'fin-1', tenantId: 'tn-1' } as SubscriptionFinanceEntry;
    const applyAction = vi.fn();
    const summary = await processSubscriptionOverdues({
      finance: {
        claimAutomaticBlockCandidates: vi.fn(async () => [source]),
        recordAutomaticBlock: vi.fn(),
      } as unknown as SubscriptionFinanceService,
      tenants: {
        get: vi.fn(async () => ({
          id: 'tn-1',
          status: 'blocked',
          meta: { lastActionReason: 'fraude confirmada pelo Master' },
        })),
        applyAction,
      } as never,
      audit: { append: vi.fn() } as never,
      notifications: { notifyBlocked: vi.fn() } as never,
    });

    expect(summary.skipped).toBe(1);
    expect(applyAction).not.toHaveBeenCalled();
  });
});

