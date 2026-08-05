// @vitest-environment node
/**
 * Testes de contrato — shape completo de validity/licenseValidity
 * e snapshots dos quatro endpoints Master críticos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCommercialLicenseViewState } from '../license/licenseValidity.js';
import {
  COMMERCIAL_VALIDITY_KEYS,
  commercialValidityShapeSnapshot,
  endpointTopLevelShapeSnapshot,
  reportMasterContractViolations,
  validateCommercialLicenseViewState,
  validateDashboardResponse,
  validateLicensesResponse,
  validateMasterEndpointResponse,
  validateOperationalCompaniesResponse,
  validateTenantsResponse,
} from './index.js';
import { MasterApiServices } from '../api/services/index.js';
import { resetMasterApiContext } from '../../services/master/masterPlatformService.js';

function sampleValidity() {
  return buildCommercialLicenseViewState({
    startsAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    licenseStatus: 'Ativa',
    now: new Date('2026-07-25T12:00:00.000Z'),
  });
}

describe('master/contract — CommercialLicenseViewState', () => {
  it('snapshot do shape canônico (chaves + enums)', () => {
    expect(commercialValidityShapeSnapshot()).toMatchSnapshot();
    expect([...COMMERCIAL_VALIDITY_KEYS].sort()).toEqual(
      [...commercialValidityShapeSnapshot().keys].sort(),
    );
  });

  it('aceita estado completo gerado pelo backend', () => {
    const validity = sampleValidity();
    const violations = validateCommercialLicenseViewState(validity, '$.validity');
    expect(violations).toEqual([]);
    for (const key of COMMERCIAL_VALIDITY_KEYS) {
      expect(validity).toHaveProperty(key);
      expect(validity[key]).not.toBe(undefined);
    }
  });

  it('detecta validity ausente e campos faltantes', () => {
    expect(validateCommercialLicenseViewState(null, '$.validity')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_VALIDITY', path: '$.validity' }),
      ]),
    );
    expect(validateCommercialLicenseViewState({ phase: 'active' }, '$.validity').length).toBeGreaterThan(
      0,
    );
  });

  it('exige conjunto exato de campos (rejeita campos extras)', () => {
    const validity = sampleValidity();
    const exactKeys = Object.keys(validity).sort();
    expect(exactKeys).toHaveLength(COMMERCIAL_VALIDITY_KEYS.length);
    expect(exactKeys).toEqual([...COMMERCIAL_VALIDITY_KEYS].sort());
    expect(COMMERCIAL_VALIDITY_KEYS).toHaveLength(14);

    expect(validateCommercialLicenseViewState(validity, '$.validity')).toEqual([]);

    const withExtra = { ...validity, experimentalFlag: true };
    expect(Object.keys(withExtra)).toHaveLength(15);
    expect(validateCommercialLicenseViewState(withExtra, '$.validity')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'EXTRA_FIELD',
          path: '$.validity.experimentalFlag',
          actual: 'experimentalFlag',
        }),
      ]),
    );
  });
});

describe('master/contract — validadores por endpoint (fixtures)', () => {
  const validity = sampleValidity();

  it('GET /licenses exige validity em central e companyLicenses', () => {
    const okPayload = {
      ok: true,
      central: [{ id: 'lic_1', tenantId: 'tn_1', validity }],
      items: [{ id: 'lic_1', tenantId: 'tn_1', validity }],
      companyLicenses: [{ id: 'lic_1', tenantId: 'tn_1', validity }],
      licenses: [{ id: 'lic_1', tenantId: 'tn_1', validity }],
    };
    const report = validateLicensesResponse(okPayload);
    expect(report.ok).toBe(true);
    expect(report.counts.missingValidityCentral).toBe(0);
    expect(report.counts.missingValidityCompanyLicenses).toBe(0);

    const broken = validateLicensesResponse({
      ok: true,
      central: [{ id: 'lic_1', tenantId: 'tn_1' }],
      companyLicenses: [{ id: 'lic_1', tenantId: 'tn_1', validity: null }],
    });
    expect(broken.ok).toBe(false);
    expect(broken.violations.some((v) => v.code === 'MISSING_VALIDITY')).toBe(true);
  });

  it('GET /tenants exige licenseValidity em cada tenant', () => {
    expect(
      validateTenantsResponse({
        ok: true,
        tenants: [{ id: 'tn_1', licenseValidity: validity }],
      }).ok,
    ).toBe(true);

    const broken = validateTenantsResponse({
      ok: true,
      tenants: [{ id: 'tn_1' }],
    });
    expect(broken.ok).toBe(false);
    expect(broken.counts.missingLicenseValidity).toBe(1);
  });

  it('GET /dashboard exige licenseValidities[].validity', () => {
    expect(
      validateDashboardResponse({
        ok: true,
        executive: {
          licenseValidities: [{ licenseId: 'lic_1', tenantId: 'tn_1', validity }],
        },
      }).ok,
    ).toBe(true);

    expect(
      validateDashboardResponse({
        ok: true,
        executive: {},
      }).ok,
    ).toBe(false);

    expect(
      validateDashboardResponse({
        ok: true,
        executive: {
          licenseValidities: [{ licenseId: 'lic_1', tenantId: 'tn_1' }],
        },
      }).ok,
    ).toBe(false);
  });

  it('GET /operational-companies exige licenseValidity em cada company', () => {
    expect(
      validateOperationalCompaniesResponse({
        ok: true,
        companies: [{ operationalCompanyId: 'co_1', licenseValidity: validity }],
        orphans: [],
        count: 1,
        uninitializedCount: 0,
      }).ok,
    ).toBe(true);

    expect(
      validateOperationalCompaniesResponse({
        ok: true,
        companies: [{ operationalCompanyId: 'co_1', licenseValidity: null }],
        orphans: [],
        count: 1,
        uninitializedCount: 0,
      }).ok,
    ).toBe(false);
  });

  it('snapshots dos top-level keys dos quatro endpoints', () => {
    const endpoints = [
      'GET /api/master/licenses',
      'GET /api/master/tenants',
      'GET /api/master/dashboard',
      'GET /api/master/operational-companies',
    ] as const;
    const shapes = Object.fromEntries(
      endpoints.map((e) => [e, endpointTopLevelShapeSnapshot(e)]),
    );
    expect(shapes).toMatchSnapshot();
  });
});

describe('master/contract — monitoramento estruturado', () => {
  it('loga warn e não lança por padrão', async () => {
    const { logger } = await import('../../logger/logger.js');
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const report = reportMasterContractViolations(
      validateTenantsResponse({ ok: true, tenants: [{ id: 'tn_x' }] }),
    );
    expect(report.ok).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'master.contract',
        action: 'MASTER_API_CONTRACT_VIOLATION',
        meta: expect.objectContaining({
          endpoint: 'GET /api/master/tenants',
        }),
      }),
    );
    spy.mockRestore();
  });

  it('throwOnViolation propaga erro após o log', async () => {
    const { logger } = await import('../../logger/logger.js');
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    expect(() =>
      reportMasterContractViolations(
        validateLicensesResponse({ ok: true, central: [{}], companyLicenses: [] }),
        { throwOnViolation: true },
      ),
    ).toThrow(/MASTER_API_CONTRACT_VIOLATION/);
    spy.mockRestore();
  });
});

describe('master/contract — respostas reais MasterApiServices (memory)', () => {
  beforeEach(() => {
    resetMasterApiContext();
    process.env.MASTER_PERSISTENCE = 'memory';
  });

  it('licenses + tenants + dashboard respeitam o contrato', async () => {
    const [licenses, tenants, dashboard] = await Promise.all([
      MasterApiServices.getLicenses(),
      MasterApiServices.getTenants(),
      MasterApiServices.getDashboard(),
    ]);

    // getLicenses (serviço legado) precisa do mesmo enrich do controller HTTP.
    const { ensureCompanyLicenseValidity } = await import(
      '../license/enrichWithCommercialValidity.js'
    );
    const { composeLicenseCentral } = await import(
      '../licenseManager/composeLicenseCentral.js'
    );
    const companyLicenses = (licenses.companyLicenses ?? []).map(ensureCompanyLicenseValidity);
    const tenantsById = new Map(
      (tenants.tenants ?? []).map((t: { id: string }) => [t.id, t]),
    );
    const central = await composeLicenseCentral({
      licenses: companyLicenses,
      tenantsById: tenantsById as never,
      invoices: [],
      audit: [],
    });
    const licensesPayload = {
      ...licenses,
      companyLicenses,
      licenses: companyLicenses,
      central,
      items: central,
    };

    const reports = [
      validateMasterEndpointResponse('GET /api/master/licenses', licensesPayload),
      validateMasterEndpointResponse('GET /api/master/tenants', tenants),
      validateMasterEndpointResponse('GET /api/master/dashboard', dashboard),
    ];

    for (const report of reports) {
      expect(report.violations, JSON.stringify(report.violations, null, 2)).toEqual([]);
      expect(report.ok).toBe(true);
    }

    // Snapshot do shape observado (sem dados voláteis).
    expect({
      licensesTopLevel: Object.keys(licensesPayload).sort(),
      tenantsTopLevel: Object.keys(tenants).sort(),
      dashboardTopLevel: Object.keys(dashboard).sort(),
      executiveKeys: Object.keys(dashboard.executive ?? {}).sort(),
      validityKeysSample:
        central[0]?.validity != null
          ? Object.keys(central[0].validity).sort()
          : companyLicenses[0]?.validity != null
            ? Object.keys(companyLicenses[0].validity).sort()
            : [],
      tenantLicenseValidityKeys:
        tenants.tenants?.[0]?.licenseValidity != null
          ? Object.keys(tenants.tenants[0].licenseValidity).sort()
          : [],
    }).toMatchSnapshot();
  });
});
