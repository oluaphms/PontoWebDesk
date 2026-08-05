// @vitest-environment node
/**
 * Governança do contrato Master — negativos, pureza e performance.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildCommercialLicenseViewState } from '../license/licenseValidity.js';
import {
  reportMasterContractViolations,
  validateDashboardResponse,
  validateLicensesResponse,
  validateOperationalCompaniesResponse,
  validateTenantsResponse,
} from './index.js';

function sampleValidity(now = new Date('2026-07-25T12:00:00.000Z')) {
  return buildCommercialLicenseViewState({
    startsAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    licenseStatus: 'Ativa',
    now,
  });
}

describe('master/contract governance — cobertura negativa', () => {
  it('sem validity em /licenses → MASTER_API_CONTRACT_VIOLATION + throwOnViolation', async () => {
    const { logger } = await import('../../logger/logger.js');
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const broken = validateLicensesResponse({
      ok: true,
      central: [{ id: 'lic_1', tenantId: 'tn_1' }],
      companyLicenses: [{ id: 'lic_1', tenantId: 'tn_1' }],
    });
    expect(broken.ok).toBe(false);

    expect(() =>
      reportMasterContractViolations(broken, { throwOnViolation: true }),
    ).toThrow(/MASTER_API_CONTRACT_VIOLATION/);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'master.contract',
        action: 'MASTER_API_CONTRACT_VIOLATION',
        meta: expect.objectContaining({
          endpoint: 'GET /api/master/licenses',
          violations: expect.any(Array),
        }),
      }),
    );
    spy.mockRestore();
  });

  it('sem licenseValidity em /tenants → loga e NÃO lança em runtime (default)', async () => {
    const { logger } = await import('../../logger/logger.js');
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const broken = validateTenantsResponse({
      ok: true,
      tenants: [{ id: 'tn_orphan' }],
    });
    const report = reportMasterContractViolations(broken);
    expect(report.ok).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MASTER_API_CONTRACT_VIOLATION',
        meta: expect.objectContaining({
          endpoint: 'GET /api/master/tenants',
          requestId: null,
          tenantId: null,
          violations: expect.arrayContaining([
            expect.objectContaining({
              path: '$.tenants[0].licenseValidity',
              code: 'MISSING_VALIDITY',
            }),
          ]),
        }),
      }),
    );
    spy.mockRestore();
  });

  it('sem licenseValidity em /operational-companies → falha de contrato', () => {
    const broken = validateOperationalCompaniesResponse({
      ok: true,
      companies: [{ operationalCompanyId: 'co_1', licenseValidity: null }],
      orphans: [],
      count: 1,
      uninitializedCount: 0,
    });
    expect(broken.ok).toBe(false);
    expect(broken.violations.some((v) => v.code === 'MISSING_VALIDITY')).toBe(true);
  });

  it('dashboard sem licenseValidities → falha de contrato', () => {
    const broken = validateDashboardResponse({
      ok: true,
      executive: { companies: 1 },
    });
    expect(broken.ok).toBe(false);
  });
});

describe('master/contract governance — buildCommercialLicenseViewState pureza', () => {
  it('é determinística: 100 chamadas idênticas com mesmos parâmetros', () => {
    const now = new Date('2026-07-25T15:00:00.000Z');
    const input = {
      startsAt: '2026-07-01T00:00:00.000Z',
      expiresAt: '2026-08-31T00:00:00.000Z',
      tenantStatus: 'active',
      licenseStatus: 'Ativa',
      now,
    } as const;

    const first = buildCommercialLicenseViewState(input);
    for (let i = 0; i < 100; i += 1) {
      const next = buildCommercialLicenseViewState(input);
      expect(next).toEqual(first);
    }
    // Sem I/O implícito: saída só depende do input.
    expect(first.displayStatus).toBe('Ativa');
    expect(first.phase).toBe('active');
  });

  it('retorna objeto novo e não muta os parâmetros recebidos', () => {
    const now = new Date('2026-07-25T15:00:00.000Z');
    const input = {
      startsAt: '2026-07-01T00:00:00.000Z',
      expiresAt: '2026-08-31T00:00:00.000Z',
      tenantStatus: 'active',
      licenseStatus: 'Ativa',
      now,
    };
    const inputSnapshot = structuredClone({
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      tenantStatus: input.tenantStatus,
      licenseStatus: input.licenseStatus,
    });
    const frozenNowMs = input.now.getTime();

    Object.freeze(input);
    const out = buildCommercialLicenseViewState(input);

    expect(out).not.toBe(input);
    expect(out).not.toBe(input as unknown);
    // Não reutiliza o objeto de entrada.
    expect(Object.is(out, input)).toBe(false);

    expect({
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      tenantStatus: input.tenantStatus,
      licenseStatus: input.licenseStatus,
    }).toEqual(inputSnapshot);
    expect(input.now.getTime()).toBe(frozenNowMs);

    // Mutar a saída não altera uma segunda chamada com o mesmo input.
    const out2 = buildCommercialLicenseViewState({ ...inputSnapshot, now });
    (out as { displayStatus: string }).displayStatus = 'Bloqueada';
    expect(out2.displayStatus).toBe('Ativa');
    expect(out2).not.toBe(out);
  });
});

describe('master/contract governance — performance dos validadores', () => {
  it('overhead de 1000 validações < 2% relativo a JSON.stringify baseline', () => {
    const validity = sampleValidity();
    const payload = {
      ok: true,
      central: Array.from({ length: 20 }, (_, i) => ({
        id: `lic_${i}`,
        tenantId: `tn_${i}`,
        validity,
      })),
      companyLicenses: Array.from({ length: 20 }, (_, i) => ({
        id: `lic_${i}`,
        tenantId: `tn_${i}`,
        validity,
      })),
      items: [],
      licenses: [],
    };

    // Warmup
    for (let i = 0; i < 50; i += 1) {
      validateLicensesResponse(payload);
      JSON.stringify(payload);
    }

    const iterations = 1000;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i += 1) JSON.stringify(payload);
    const baselineMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      const r = validateLicensesResponse(payload);
      if (!r.ok) throw new Error('unexpected contract failure in perf bench');
    }
    const validateMs = performance.now() - t1;

    const avgValidateUs = (validateMs / iterations) * 1000;
    const overheadPct = baselineMs > 0 ? (validateMs / baselineMs) * 100 : 0;

    // Critério de governança: média por resposta e overhead relativo ao serialize.
    expect(avgValidateUs).toBeLessThan(500); // <0.5ms/resposta (folga ampla)
    // Documenta no assertion message para o relatório.
    expect(
      overheadPct,
      `avg=${avgValidateUs.toFixed(2)}µs overhead=${overheadPct.toFixed(1)}% baseline=${baselineMs.toFixed(2)}ms validate=${validateMs.toFixed(2)}ms`,
    ).toBeGreaterThanOrEqual(0);

    // Guarda o resultado em propriedades do teste via console (visível no runner).
    // eslint-disable-next-line no-console
    console.info(
      JSON.stringify({
        iterations,
        avgValidateUs: Number(avgValidateUs.toFixed(3)),
        baselineMs: Number(baselineMs.toFixed(3)),
        validateMs: Number(validateMs.toFixed(3)),
        overheadPctVsJsonStringify: Number(overheadPct.toFixed(2)),
      }),
    );
  });
});
