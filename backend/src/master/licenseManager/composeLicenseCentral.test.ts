// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LicenseManagerService } from './LicenseManagerService.js';
import {
  appendLicenseHistory,
  lastPaidInvoiceForTenant,
  toLicenseCentralRow,
} from './composeLicenseCentral.js';
import type { Invoice } from '../billingEngine/types.js';
import type { ManagedTenant } from '../tenantManager/tenantManager.types.js';

describe('License Central (FASE 26)', () => {
  it('suspend marca blockKind suspended; reactivate restaura Ativa', async () => {
    const svc = LicenseManagerService.createInMemory();
    const lic = await svc.create({
      tenantId: 'tn_central_1',
      empresa: 'Central Co',
      status: 'Ativa',
      durationDays: 90,
    });
    const suspended = await svc.action(lic.id, 'suspend', { reason: 'inadimplencia' });
    expect(suspended.status).toBe('Bloqueada');
    expect(suspended.meta?.blockKind).toBe('suspended');
    expect(suspended.blockedReason).toContain('inadimplencia');

    const reactivated = await svc.action(lic.id, 'reactivate');
    expect(reactivated.status).toBe('Ativa');
    expect(reactivated.blockedAt).toBeNull();
    expect(reactivated.meta?.blockKind).toBeNull();
  });

  it('grava histórico em meta após ações', async () => {
    const svc = LicenseManagerService.createInMemory();
    const lic = await svc.create({
      tenantId: 'tn_hist',
      empresa: 'Hist Co',
      status: 'Ativa',
      durationDays: 30,
    });
    await svc.action(lic.id, 'block');
    await svc.action(lic.id, 'renew', { durationDays: 365 });
    const row = await svc.get(lic.id);
    const history = row.meta?.history as Array<{ action: string }>;
    expect(Array.isArray(history)).toBe(true);
    expect(history[0]?.action).toBe('renew');
    expect(history.some((h) => h.action === 'block')).toBe(true);
  });

  it('update persiste limites e compõe linha da Central', async () => {
    const svc = LicenseManagerService.createInMemory();
    const lic = await svc.create({
      tenantId: 'tn_limits',
      empresa: 'Limits Co',
      plan: 'PRO',
      mode: 'SAAS',
      status: 'Ativa',
      durationDays: 60,
    });
    const updated = await svc.update(lic.id, {
      maxEmployees: 50,
      maxDevices: 10,
      licenseKey: 'lic_central_test',
    });
    expect(updated.meta?.maxEmployees).toBe(50);
    expect(updated.meta?.maxDevices).toBe(10);

    const tenant = {
      id: 'tn_limits',
      plan: 'PRO',
      status: 'active',
      mode: 'SAAS',
      gateway: 'none',
      installationType: 'SAAS_WEB',
      license: { licenseKey: 'lic_from_tenant' },
      company: { name: 'Limits Co' },
      admin: { name: 'A', email: 'a@x.com' },
      domain: 'limits.local',
      storage: { driver: 'none' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as ManagedTenant;

    const invoices: Invoice[] = [
      {
        id: 'inv_1',
        provider: 'asaas',
        tenantId: 'tn_limits',
        customerId: null,
        description: 'Mensalidade',
        amountCents: 9900,
        currency: 'BRL',
        status: 'paid',
        dueAt: null,
        paidAt: '2026-07-01T12:00:00.000Z',
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-07-01T12:00:00.000Z',
      },
    ];

    const central = toLicenseCentralRow({
      license: updated,
      tenant,
      invoices,
      versionsByCompany: new Map([['tn_limits', '1.2.3']]),
      audit: [],
    });
    expect(central.empresa).toBe('Limits Co');
    expect(central.plan).toBe('PRO');
    expect(central.tipo).toBe('SAAS');
    expect(central.licenseKey).toBe('lic_from_tenant');
    expect(central.maxEmployees).toBe(50);
    expect(central.maxDevices).toBe(10);
    expect(central.lastPaymentAt).toBe('2026-07-01T12:00:00.000Z');
    expect(central.lastPaymentAmountCents).toBe(9900);
    expect(central.installedVersion).toBe('1.2.3');
    expect(central.isBlocked).toBe(false);
  });

  it('lastPaidInvoiceForTenant escolhe o pagamento mais recente', () => {
    const invoices: Invoice[] = [
      {
        id: 'a',
        provider: 'asaas',
        tenantId: 'tn_x',
        customerId: null,
        description: '',
        amountCents: 100,
        currency: 'BRL',
        status: 'paid',
        dueAt: null,
        paidAt: '2026-01-01T00:00:00.000Z',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'b',
        provider: 'asaas',
        tenantId: 'tn_x',
        customerId: null,
        description: '',
        amountCents: 200,
        currency: 'BRL',
        status: 'paid',
        dueAt: null,
        paidAt: '2026-06-01T00:00:00.000Z',
        createdAt: '',
        updatedAt: '',
      },
    ];
    const last = lastPaidInvoiceForTenant(invoices, 'tn_x');
    expect(last.amountCents).toBe(200);
    expect(last.at).toContain('2026-06-01');
  });

  it('appendLicenseHistory prepende e limita tamanho', () => {
    let meta: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++) {
      meta = appendLicenseHistory(meta, {
        at: `2026-07-0${i + 1}T00:00:00.000Z`,
        action: `act_${i}`,
      }, 3);
    }
    const history = meta.history as Array<{ action: string }>;
    expect(history).toHaveLength(3);
    expect(history[0].action).toBe('act_4');
  });
});
