/**
 * Vigência comercial — calendário America/Sao_Paulo, fim inclusivo, sem tolerância.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateCommercialLicense,
  evaluateLicenseValidity,
  resolveCompanyLicenseDisplayStatus,
  toBrazilDateOnly,
  LICENSE_VALIDITY_TIMEZONE,
} from './licenseValidity.js';

describe('evaluateCommercialLicense (BRT)', () => {
  it('usa America/Sao_Paulo', () => {
    expect(LICENSE_VALIDITY_TIMEZONE).toBe('America/Sao_Paulo');
  });

  it('bloqueia antes do início (início amanhã BRT)', () => {
    const now = new Date('2026-07-24T15:00:00.000-03:00');
    const v = evaluateCommercialLicense({
      startsAt: '2026-07-25',
      expiresAt: '2026-08-25',
      now,
    });
    expect(v.phase).toBe('scheduled');
    expect(v.shouldBlock).toBe(true);
    expect(v.reason).toBe('license_not_started');
    expect(v.remainingLabel).toBe('Inicia em 1 dia');
  });

  it('permite no dia do início (BRT)', () => {
    const now = new Date('2026-07-24T08:00:00.000-03:00');
    const v = evaluateCommercialLicense({
      startsAt: '2026-07-24',
      expiresAt: '2026-08-24',
      now,
    });
    expect(v.phase).toBe('active');
    expect(v.shouldBlock).toBe(false);
  });

  it('permite até 23:59:59 America/Sao_Paulo no último dia', () => {
    // 24/08/2026 23:59:59 BRT
    const now = new Date('2026-08-24T23:59:59.000-03:00');
    const v = evaluateCommercialLicense({
      startsAt: '2026-07-24',
      expiresAt: '2026-08-24',
      now,
    });
    expect(toBrazilDateOnly(now)).toBe('2026-08-24');
    expect(v.phase).toBe('active');
    expect(v.shouldBlock).toBe(false);
    expect(v.remainingLabel).toBe('Último dia de vigência');
  });

  it('ainda válido à meia-noite UTC quando ainda é o último dia em BRT', () => {
    // 25/08/2026 02:00 UTC = 24/08/2026 23:00 BRT
    const now = new Date('2026-08-25T02:00:00.000Z');
    const v = evaluateCommercialLicense({
      startsAt: '2026-07-24',
      expiresAt: '2026-08-24',
      now,
    });
    expect(toBrazilDateOnly(now)).toBe('2026-08-24');
    expect(v.shouldBlock).toBe(false);
    expect(v.phase).toBe('active');
  });

  it('bloqueia no primeiro segundo do dia seguinte (BRT)', () => {
    // 25/08/2026 00:00:00 BRT
    const now = new Date('2026-08-25T00:00:00.000-03:00');
    const v = evaluateCommercialLicense({
      startsAt: '2026-07-24',
      expiresAt: '2026-08-24',
      now,
    });
    expect(toBrazilDateOnly(now)).toBe('2026-08-25');
    expect(v.phase).toBe('expired');
    expect(v.shouldBlock).toBe(true);
    expect(v.reason).toBe('license_validity_expired');
    expect(v.remainingLabel).toBe('Expirada há 1 dia');
  });

  it('não concede dias de tolerância após o vencimento', () => {
    const now = new Date('2026-08-25T12:00:00.000-03:00');
    const v = evaluateCommercialLicense({
      startsAt: '2026-07-24',
      expiresAt: '2026-08-24',
      now,
    });
    expect(v.shouldBlock).toBe(true);
    expect(v.phase).toBe('expired');
  });

  it('sem startsAt usa o dia atual BRT como início (compatibilidade)', () => {
    const now = new Date('2026-07-24T12:00:00.000-03:00');
    const v = evaluateCommercialLicense({
      startsAt: null,
      expiresAt: '2026-07-30',
      now,
    });
    expect(v.startsAtEffective).toBe('2026-07-24');
    expect(v.phase).toBe('active');
    expect(v.shouldBlock).toBe(false);
  });

  it('toBrazilDateOnly normaliza instante ISO pelo fuso BRT', () => {
    // 24/07/2026 22:00 BRT = 25/07/2026 01:00 UTC
    expect(toBrazilDateOnly('2026-07-25T01:00:00.000Z')).toBe('2026-07-24');
    expect(toBrazilDateOnly('2026-07-24')).toBe('2026-07-24');
  });

  it('evaluateLicenseValidity é alias de evaluateCommercialLicense', () => {
    const now = new Date('2026-07-24T12:00:00.000-03:00');
    const a = evaluateCommercialLicense({ startsAt: '2026-07-24', expiresAt: '2026-08-01', now });
    const b = evaluateLicenseValidity({ startsAt: '2026-07-24', expiresAt: '2026-08-01', now });
    expect(b).toEqual(a);
  });
});

describe('buildCommercialLicenseViewState', () => {
  it('entrega displayStatus alinhado à fase (fonte única para API)', async () => {
    const { buildCommercialLicenseViewState } = await import('./licenseValidity.js');
    const lastDay = buildCommercialLicenseViewState({
      startsAt: '2026-01-01',
      expiresAt: '2026-08-31',
      licenseStatus: 'Ativa',
      now: new Date('2026-08-31T23:59:59.000-03:00'),
    });
    expect(lastDay.phase).toBe('active');
    expect(lastDay.displayStatus).toBe('Ativa');
    expect(lastDay.expiresToday).toBe(true);
    expect(lastDay.shouldBlock).toBe(false);

    const nextDay = buildCommercialLicenseViewState({
      startsAt: '2026-01-01',
      expiresAt: '2026-08-31',
      licenseStatus: 'Ativa',
      now: new Date('2026-09-01T00:00:00.000-03:00'),
    });
    expect(nextDay.phase).toBe('expired');
    expect(nextDay.displayStatus).toBe('Expirada');
    expect(nextDay.shouldBlock).toBe(true);
    expect(nextDay.daysExpired).toBe(1);

    const scheduled = buildCommercialLicenseViewState({
      startsAt: '2026-09-10',
      expiresAt: '2026-12-31',
      licenseStatus: 'Ativa',
      now: new Date('2026-09-01T12:00:00.000-03:00'),
    });
    expect(scheduled.displayStatus).toBe('Agendada');
  });
});

describe('resolveCompanyLicenseDisplayStatus', () => {
  it('prioriza bloqueio manual', () => {
    const validity = evaluateCommercialLicense({
      startsAt: '2026-01-01',
      expiresAt: '2026-12-31',
      now: new Date('2026-07-24T12:00:00.000-03:00'),
    });
    expect(
      resolveCompanyLicenseDisplayStatus({
        tenantStatus: 'blocked',
        licenseStatus: 'Ativa',
        validity,
      }),
    ).toBe('Bloqueada');
  });
});
