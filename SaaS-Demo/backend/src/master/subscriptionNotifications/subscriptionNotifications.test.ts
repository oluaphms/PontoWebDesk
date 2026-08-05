// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { MasterSqlQuery } from '../adapters/postgres/masterSql.js';
import { MasterNotifications } from '../journey/masterNotifications.js';
import { templateForKind } from './notificationTemplates.js';
import { SubscriptionNotificationService } from './SubscriptionNotificationService.js';
import { releaseCompanyAfterSubscriptionPayment } from './releaseOnPayment.js';
import type { SubscriptionFinanceEntry } from '../subscriptionFinance/subscriptionFinance.types.js';

function result<R extends QueryResultRow>(rows: R[]): QueryResult<R> {
  return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
}

describe('Fase 6.5 — notificações automáticas', () => {
  it('usa os textos canônicos dos avisos', () => {
    expect(templateForKind('DUE_IN_7').message).toBe('Seu plano vencerá em 7 dias.');
    expect(templateForKind('DUE_IN_3').message).toBe('Segundo aviso.');
    expect(templateForKind('DUE_TODAY').message).toBe('Pagamento pendente.');
    expect(templateForKind('BLOCKED').message).toContain('Empresa bloqueada.');
    expect(templateForKind('BLOCKED').message).toContain('Clique aqui para regularizar.');
    expect(templateForKind('PAID_RELEASED').message).toContain('Pagamento recebido.');
    expect(templateForKind('PAID_RELEASED').message).toContain(
      'Sua empresa foi liberada automaticamente',
    );
  });

  it('grava e entrega notificação com dedupe por canal', async () => {
    MasterNotifications.clear();
    let insertCount = 0;
    const sql: MasterSqlQuery = async <R extends QueryResultRow = QueryResultRow>(
      query: string,
      values: unknown[] = [],
    ): Promise<QueryResult<R>> => {
      if (query.includes('LEFT JOIN public.master_subscription_notification_preferences')) {
        return result([{
          tenant_id: 'tn-1',
          company_id: 'co-1',
          receive_email: true,
          notify_due_in_7: true,
          notify_due_in_3: true,
          notify_due_today: true,
          notify_after_block: true,
          updated_at: null,
        }] as unknown as R[]);
      }
      if (query.includes('INSERT INTO public.master_subscription_notifications')) {
        insertCount += 1;
        if (insertCount > 2) return result([]);
        return result([{
          id: values[0],
          finance_entry_id: values[1],
          tenant_id: values[2],
          company_id: values[3],
          kind: values[4],
          channel: values[5],
          recipient: values[6],
          title: values[7],
          message: values[8],
          status: 'QUEUED',
          sent_at: null,
          error: null,
          created_at: '2026-07-21T12:00:00.000Z',
          meta: {},
        }] as unknown as R[]);
      }
      if (query.includes('UPDATE public.master_subscription_notifications')) {
        return result([{
          id: values[0],
          finance_entry_id: 'fin-1',
          tenant_id: 'tn-1',
          company_id: 'co-1',
          kind: 'DUE_IN_7',
          channel: 'COMPANY_ADMIN',
          recipient: 'admin@acme.test',
          title: 'Aviso de vencimento',
          message: 'Seu plano vencerá em 7 dias.',
          status: values[1],
          sent_at: '2026-07-21T12:00:00.000Z',
          error: null,
          created_at: '2026-07-21T12:00:00.000Z',
          meta: {},
        }] as unknown as R[]);
      }
      if (query.includes('FROM public.users')) {
        return result([{ id: 'user-admin-1' }] as unknown as R[]);
      }
      if (query.includes('INSERT INTO public.notifications')) {
        return result([] as unknown as R[]);
      }
      return result([]);
    };

    const service = new SubscriptionNotificationService(sql);
    const rows = await service.notify({
      financeEntryId: 'fin-1',
      tenantId: 'tn-1',
      companyId: 'co-1',
      companyName: 'Acme',
      adminEmail: 'admin@acme.test',
      kind: 'DUE_IN_7',
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'SENT')).toBe(true);
    expect(MasterNotifications.list(10, 'tn-1').length).toBeGreaterThanOrEqual(1);
  });

  it('respeita aviso desativado para a empresa e mantém o inbox Master', async () => {
    MasterNotifications.clear();
    const channels: string[] = [];
    const sql: MasterSqlQuery = async <R extends QueryResultRow = QueryResultRow>(
      query: string,
      values: unknown[] = [],
    ): Promise<QueryResult<R>> => {
      if (query.includes('LEFT JOIN public.master_subscription_notification_preferences')) {
        return result([{
          tenant_id: 'tn-1',
          company_id: 'co-1',
          receive_email: false,
          notify_due_in_7: false,
          notify_due_in_3: true,
          notify_due_today: true,
          notify_after_block: true,
          updated_at: null,
        }] as unknown as R[]);
      }
      if (query.includes('INSERT INTO public.master_subscription_notifications')) {
        channels.push(String(values[5]));
        return result([{
          id: values[0],
          finance_entry_id: values[1],
          tenant_id: values[2],
          company_id: values[3],
          kind: values[4],
          channel: values[5],
          recipient: values[6],
          title: values[7],
          message: values[8],
          status: 'QUEUED',
          sent_at: null,
          error: null,
          created_at: '2026-07-21T12:00:00.000Z',
          meta: {},
        }] as unknown as R[]);
      }
      if (query.includes('UPDATE public.master_subscription_notifications')) {
        return result([{
          id: values[0],
          finance_entry_id: 'fin-1',
          tenant_id: 'tn-1',
          company_id: 'co-1',
          kind: 'DUE_IN_7',
          channel: 'MASTER_INBOX',
          recipient: 'master',
          title: 'Aviso de vencimento',
          message: 'Acme: Seu plano vencerá em 7 dias.',
          status: values[1],
          sent_at: '2026-07-21T12:00:00.000Z',
          error: null,
          created_at: '2026-07-21T12:00:00.000Z',
          meta: {},
        }] as unknown as R[]);
      }
      return result([]);
    };

    const rows = await new SubscriptionNotificationService(sql).notify({
      financeEntryId: 'fin-1',
      tenantId: 'tn-1',
      companyId: 'co-1',
      companyName: 'Acme',
      adminEmail: 'admin@acme.test',
      kind: 'DUE_IN_7',
    });

    expect(channels).toEqual(['MASTER_INBOX']);
    expect(rows).toHaveLength(1);
  });

  it('não marca SENT no canal da empresa sem gravar no inbox SaaS', async () => {
    MasterNotifications.clear();
    const companyAdminStatuses: string[] = [];
    const channelById = new Map<string, string>();
    const sql: MasterSqlQuery = async <R extends QueryResultRow = QueryResultRow>(
      query: string,
      values: unknown[] = [],
    ): Promise<QueryResult<R>> => {
      if (query.includes('LEFT JOIN public.master_subscription_notification_preferences')) {
        return result([{
          tenant_id: 'tn-1',
          company_id: 'co-1',
          receive_email: true,
          notify_due_in_7: true,
          notify_due_in_3: true,
          notify_due_today: true,
          notify_after_block: true,
          updated_at: null,
        }] as unknown as R[]);
      }
      if (query.includes('INSERT INTO public.master_subscription_notifications')) {
        channelById.set(String(values[0]), String(values[5]));
        return result([{
          id: values[0],
          finance_entry_id: values[1],
          tenant_id: values[2],
          company_id: values[3],
          kind: values[4],
          channel: values[5],
          recipient: values[6],
          title: values[7],
          message: values[8],
          status: 'QUEUED',
          sent_at: null,
          error: null,
          created_at: '2026-07-21T12:00:00.000Z',
          meta: {},
        }] as unknown as R[]);
      }
      if (query.includes('UPDATE public.master_subscription_notifications')) {
        const id = String(values[0]);
        const channel = channelById.get(id) || 'MASTER_INBOX';
        const status = String(values[1]);
        if (channel === 'COMPANY_ADMIN') companyAdminStatuses.push(status);
        return result([{
          id,
          finance_entry_id: 'fin-miss',
          tenant_id: 'tn-1',
          company_id: 'co-1',
          kind: 'DUE_TODAY',
          channel,
          recipient: channel === 'COMPANY_ADMIN' ? 'admin@acme.test' : 'master',
          title: 'Pagamento pendente',
          message: 'Pagamento pendente.',
          status,
          sent_at: status === 'SENT' ? '2026-07-21T12:00:00.000Z' : null,
          error: values[2] ?? null,
          created_at: '2026-07-21T12:00:00.000Z',
          meta: {},
        }] as unknown as R[]);
      }
      if (query.includes('FROM public.master_tenants')) {
        return result([{ id: 'tn-1', operational_company_id: 'co-1' }] as unknown as R[]);
      }
      if (query.includes('FROM public.users')) {
        return result([] as unknown as R[]);
      }
      return result([]);
    };

    const rows = await new SubscriptionNotificationService(sql).notify({
      financeEntryId: 'fin-miss',
      tenantId: 'tn-1',
      companyId: 'co-1',
      companyName: 'Acme',
      adminEmail: 'admin@acme.test',
      kind: 'DUE_TODAY',
    });

    expect(rows.some((r) => r.channel === 'MASTER_INBOX' && r.status === 'SENT')).toBe(true);
    expect(rows.some((r) => r.channel === 'COMPANY_ADMIN' && r.status === 'SKIPPED')).toBe(true);
    expect(companyAdminStatuses).toEqual(['SKIPPED']);
  });

  it('libera apenas bloqueio por inadimplência e notifica pagamento', async () => {
    const applyAction = vi.fn(async () => ({ id: 'tn-1', status: 'active', meta: {} }));
    const append = vi.fn(async (input: unknown) => input);
    const notifyPaidReleased = vi.fn(async () => [
      { id: 'ntf-1', channel: 'MASTER_INBOX', status: 'SENT' },
      { id: 'ntf-2', channel: 'COMPANY_ADMIN', status: 'SENT' },
    ]);
    const entry = {
      id: 'fin-paid',
      subscriptionId: 'sub-1',
      tenantId: 'tn-1',
      companyId: 'co-1',
      companyName: 'Acme',
    } as SubscriptionFinanceEntry;

    const outcome = await releaseCompanyAfterSubscriptionPayment(entry, {
      tenants: {
        get: vi.fn(async () => ({
          id: 'tn-1',
          status: 'blocked',
          meta: { lastActionReason: 'subscription_overdue:fin-paid' },
        })),
        applyAction,
      } as never,
      audit: { append } as never,
      notifications: { notifyPaidReleased } as never,
      sql: (async (query: string) => {
        if (query.includes('UPDATE public.master_subscriptions')) {
          return result([{ id: 'sub-1' }]);
        }
        return result([{ admin_email: 'admin@acme.test' }]);
      }) as never,
    });

    expect(outcome.released).toBe(true);
    expect(outcome.subscriptionReactivated).toBe(true);
    expect(applyAction).toHaveBeenCalledWith('tn-1', 'unblock', {
      reason: 'subscription_payment:fin-paid',
    });
    expect(notifyPaidReleased).toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUBSCRIPTION_AUTO_RELEASED' }),
    );
  });

  it('não libera bloqueio administrativo no pagamento', async () => {
    const applyAction = vi.fn();
    const entry = {
      id: 'fin-paid',
      subscriptionId: 'sub-1',
      tenantId: 'tn-1',
      companyId: 'co-1',
      companyName: 'Acme',
    } as SubscriptionFinanceEntry;

    const outcome = await releaseCompanyAfterSubscriptionPayment(entry, {
      tenants: {
        get: vi.fn(async () => ({
          id: 'tn-1',
          status: 'blocked',
          meta: { lastActionReason: 'fraude confirmada pelo Master' },
        })),
        applyAction,
      } as never,
      audit: { append: vi.fn() } as never,
      notifications: {
        notifyPaidReleased: vi.fn(async () => []),
      } as never,
      sql: (async () => result([])) as never,
    });

    expect(outcome.released).toBe(false);
    expect(applyAction).not.toHaveBeenCalled();
  });
});
