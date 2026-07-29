// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildCommercialReportsSnapshot,
  groupCounts,
  inPeriod,
  parsePeriod,
} from './commercialReports.types.js';

describe('commercialReports (FASE 29)', () => {
  it('groupCounts agrega cidades e planos', () => {
    expect(groupCounts(['SP', 'RJ', 'SP', null])).toEqual([
      { name: 'SP', count: 2 },
      { name: 'RJ', count: 1 },
      { name: 'Sem informação', count: 1 },
    ]);
  });

  it('parsePeriod aceita datas de dia inteiro', () => {
    const p = parsePeriod('2026-07-01', '2026-07-31');
    expect(p.fromMs).not.toBeNull();
    expect(p.toMs).not.toBeNull();
    expect(p.toMs! > p.fromMs!).toBe(true);
  });

  it('inPeriod filtra ISO', () => {
    const from = Date.parse('2026-07-01T00:00:00.000Z');
    const to = Date.parse('2026-07-31T23:59:59.999Z');
    expect(inPeriod('2026-07-15T12:00:00.000Z', from, to)).toBe(true);
    expect(inPeriod('2026-06-15T12:00:00.000Z', from, to)).toBe(false);
  });

  it('buildCommercialReportsSnapshot monta payload', () => {
    const snap = buildCommercialReportsSnapshot({
      period: { from: null, to: null },
      kpis: {
        companiesByCity: [{ name: 'SP', count: 2 }],
        companiesByPlan: [{ name: 'PRO', count: 3 }],
        clientsActive: 3,
        clientsBlocked: 1,
        clientsTrial: 2,
        revenueMonthCents: 1000,
        revenueYearCents: 12000,
        licensesExpiring: 1,
        companiesWithoutLogin: 2,
        companiesWithoutUpdate: 1,
        updatesCompleted: 4,
        updatesFailed: 1,
        implantationsCompleted: 2,
      },
      tables: {
        byCity: [],
        byPlan: [],
        licensesExpiring: [],
        withoutLogin: [],
        withoutUpdate: [],
        updatesCompleted: [],
        updatesFailed: [],
        implantationsCompleted: [],
      },
      sources: {
        tenants: 'master_tenants',
        crm: 'master_crm',
        billing: 'billing',
        licenses: 'license_manager',
        updates: 'update_control_plane',
        journey: 'commercial_onboardings',
      },
    });
    expect(snap.kpis.clientsActive).toBe(3);
    expect(snap.note).toContain('Central de Relatórios');
  });
});
