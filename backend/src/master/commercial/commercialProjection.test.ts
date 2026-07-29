/**
 * Deriva snapshot comercial a partir do estado Master.
 */
import { describe, expect, it } from 'vitest';
import { deriveCommercialProjection } from './deriveCommercialProjection.js';
import { findCommercialFieldsInPayload } from './commercialFields.js';

describe('deriveCommercialProjection', () => {
  it('projeta plano operacional e modo a partir do Master', () => {
    const snap = deriveCommercialProjection({
      tenantId: 'co-1',
      tenantStatus: 'active',
      tenantPlan: 'PRO',
      tenantMode: 'SAAS',
      licenseStatus: 'Ativa',
      subscriptionStatus: 'ACTIVE',
      paymentStatus: 'paid',
      storageMaxGb: 50,
    });
    expect(snap.plan).toBe('pro');
    expect(snap.commercialPlan).toBe('PRO');
    expect(snap.commercialMode).toBe('SAAS');
    expect(snap.commercialBlocked).toBe(false);
    expect(snap.contractedLimits.maxStorageGb).toBe(50);
    expect(snap.commercialSource).toBe('master');
  });

  it('bloqueia apenas pelo estado da licença Master quando tenant está ativo', () => {
    const snap = deriveCommercialProjection({
      tenantId: 'co-1',
      tenantStatus: 'active',
      tenantPlan: 'PRO',
      tenantMode: 'SAAS',
      licenseStatus: 'Bloqueada',
      licenseBlockedReason: 'inadimplencia',
      subscriptionStatus: 'ACTIVE',
    });
    expect(snap.commercialBlocked).toBe(true);
    expect(snap.commercialBlockReason).toBe('inadimplencia');
  });

  it('prioriza bloqueio administrativo do tenant sobre a licença', () => {
    const snap = deriveCommercialProjection({
      tenantId: 'co-1',
      tenantStatus: 'blocked',
      tenantPlan: 'PRO',
      licenseStatus: 'Ativa',
    });
    expect(snap.commercialBlocked).toBe(true);
    expect(snap.commercialBlockReason).toBe('tenant_blocked_by_master');
  });

  it('bloqueia por licença expirada', () => {
    const snap = deriveCommercialProjection({
      tenantId: 'co-1',
      tenantStatus: 'active',
      licenseStatus: 'Expirada',
    });
    expect(snap.commercialBlocked).toBe(true);
    expect(snap.commercialBlockReason).toBe('license_expired_by_master');
  });

  it('bloqueia por vigência ainda não iniciada', () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const snap = deriveCommercialProjection({
      tenantId: 'co-1',
      tenantStatus: 'active',
      licenseStatus: 'Ativa',
      licenseStartsAt: tomorrow.toISOString().slice(0, 10),
      licenseExpiresAt: '2099-12-31',
    });
    expect(snap.commercialBlocked).toBe(true);
    expect(snap.commercialBlockReason).toBe('license_not_started');
  });

  it('bloqueia no dia seguinte ao fim da vigência (sem tolerância)', () => {
    const past = new Date();
    past.setUTCDate(past.getUTCDate() - 10);
    const snap = deriveCommercialProjection({
      tenantId: 'co-1',
      tenantStatus: 'active',
      licenseStatus: 'Ativa',
      licenseStartsAt: '2020-01-01',
      licenseExpiresAt: past.toISOString().slice(0, 10),
    });
    expect(snap.commercialBlocked).toBe(true);
    expect(snap.commercialBlockReason).toBe('license_validity_expired');
  });

  it('bloqueia no 1º dia após o vencimento (sem tolerância)', () => {
    const brtToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const [y, m, d] = brtToday.split('-').map(Number);
    const endMs = Date.UTC(y, m - 1, d) - 86_400_000;
    const endYmd = new Date(endMs).toISOString().slice(0, 10);
    const snap = deriveCommercialProjection({
      tenantId: 'co-1',
      tenantStatus: 'active',
      licenseStatus: 'Ativa',
      licenseStartsAt: '2020-01-01',
      licenseExpiresAt: endYmd,
    });
    expect(snap.commercialBlocked).toBe(true);
    expect(snap.commercialBlockReason).toBe('license_validity_expired');
  });

  it('permite no último dia da vigência (calendário BRT)', () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const snap = deriveCommercialProjection({
      tenantId: 'co-1',
      tenantStatus: 'active',
      licenseStatus: 'Ativa',
      licenseStartsAt: '2020-01-01',
      licenseExpiresAt: today,
    });
    expect(snap.commercialBlocked).toBe(false);
  });

  it('projeta limites de funcionários e dispositivos a partir da licença Master', () => {
    const snap = deriveCommercialProjection({
      tenantId: 'co-1',
      tenantStatus: 'active',
      tenantPlan: 'ENTERPRISE',
      licenseStatus: 'Ativa',
      licenseMaxUsers: 120,
      licenseMaxDevices: 8,
      storageMaxGb: 100,
    });
    expect(snap.contractedLimits.maxUsers).toBe(120);
    expect(snap.contractedLimits.maxDevices).toBe(8);
    expect(snap.contractedLimits.maxStorageGb).toBe(100);
  });
});

describe('findCommercialFieldsInPayload', () => {
  it('detecta campos comerciais proibidos no SaaS', () => {
    expect(
      findCommercialFieldsInPayload({
        name: 'Empresa',
        plan: 'enterprise',
        commercial_blocked: true,
      }),
    ).toEqual(['plan', 'commercial_blocked']);
  });

  it('ignora campos operacionais', () => {
    expect(findCommercialFieldsInPayload({ name: 'Empresa', cnpj: '00' })).toEqual([]);
  });

  it('protege company_session_version', () => {
    expect(findCommercialFieldsInPayload({ company_session_version: 2 })).toEqual([
      'company_session_version',
    ]);
  });
});
