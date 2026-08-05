/**
 * Validadores de contrato das quatro respostas Master críticas para vigência.
 */
import {
  validateCommercialLicenseViewState,
  type ContractViolation,
} from './commercialValidityShape.js';

export type MasterContractEndpoint =
  | 'GET /api/master/licenses'
  | 'GET /api/master/tenants'
  | 'GET /api/master/tenants/:id'
  | 'POST /api/master/tenants'
  | 'PATCH /api/master/tenants/:id'
  | 'POST /api/master/tenants/:id/actions/:action'
  | 'GET /api/master/dashboard'
  | 'GET /api/master/summary'
  | 'GET /api/master/operational-companies'
  | 'POST /api/master/licenses'
  | 'PATCH /api/master/licenses/:id'
  | 'POST /api/master/licenses/:id/rules'
  | 'POST /api/master/licenses/:id/actions/:action';

/**
 * Rotas que expõem vigência e DEVEM chamar reportMasterContractViolations.
 * Usado pelo teste de governança do router.
 */
export const MASTER_VALIDITY_ROUTE_COVERAGE: ReadonlyArray<{
  method: string;
  path: string;
  handler: string;
  validator: string;
  controllerFile: string;
}> = [
  {
    method: 'GET',
    path: '/dashboard',
    handler: 'getDashboard',
    validator: 'validateDashboardResponse',
    controllerFile: 'masterApi.controllers.ts',
  },
  {
    method: 'GET',
    path: '/summary',
    handler: 'getSummary',
    validator: 'validateSummaryResponse',
    controllerFile: 'masterApi.controllers.ts',
  },
  {
    method: 'GET',
    path: '/tenants',
    handler: 'getTenants',
    validator: 'validateTenantsResponse',
    controllerFile: 'masterApi.controllers.ts',
  },
  {
    method: 'GET',
    path: '/tenants/:id',
    handler: 'getTenant',
    validator: 'validateTenantResponse',
    controllerFile: 'masterApi.controllers.ts',
  },
  {
    method: 'POST',
    path: '/tenants',
    handler: 'postTenant',
    validator: 'validateTenantResponse',
    controllerFile: 'masterApi.controllers.ts',
  },
  {
    method: 'PATCH',
    path: '/tenants/:id',
    handler: 'patchTenant',
    validator: 'validateTenantResponse',
    controllerFile: 'masterApi.controllers.ts',
  },
  {
    method: 'POST',
    path: '/tenants/:id/actions/:action',
    handler: 'postTenantAction',
    validator: 'validateTenantResponse',
    controllerFile: 'masterApi.controllers.ts',
  },
  {
    method: 'GET',
    path: '/licenses',
    handler: 'getLicensesManager',
    validator: 'validateLicensesResponse',
    controllerFile: 'licenseManager.controllers.ts',
  },
  {
    method: 'POST',
    path: '/licenses',
    handler: 'postCompanyLicense',
    validator: 'validateLicenseMutationResponse',
    controllerFile: 'licenseManager.controllers.ts',
  },
  {
    method: 'PATCH',
    path: '/licenses/:id',
    handler: 'patchCompanyLicense',
    validator: 'validateLicenseMutationResponse',
    controllerFile: 'licenseManager.controllers.ts',
  },
  {
    method: 'POST',
    path: '/licenses/:id/rules',
    handler: 'postCompanyLicenseRules',
    validator: 'validateLicenseMutationResponse',
    controllerFile: 'licenseManager.controllers.ts',
  },
  {
    method: 'POST',
    path: '/licenses/:id/actions/:action',
    handler: 'postCompanyLicenseAction',
    validator: 'validateLicenseMutationResponse',
    controllerFile: 'licenseManager.controllers.ts',
  },
  {
    method: 'GET',
    path: '/operational-companies',
    handler: 'getOperationalCompaniesDirectory',
    validator: 'validateOperationalCompaniesResponse',
    controllerFile: 'operationalDiscovery.controllers.ts',
  },
];

export type MasterContractReport = {
  endpoint: MasterContractEndpoint;
  ok: boolean;
  violations: ContractViolation[];
  checkedAt: string;
  counts: Record<string, number>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function requireArray(
  value: unknown,
  path: string,
  violations: ContractViolation[],
): unknown[] | null {
  if (!Array.isArray(value)) {
    violations.push({
      path,
      code: 'MISSING_ARRAY',
      message: `${path} deve ser array`,
      actual: value == null ? value : typeof value,
    });
    return null;
  }
  return value;
}

/** Shape estável (chaves top-level) para snapshot — sem dados voláteis. */
export function endpointTopLevelShapeSnapshot(endpoint: MasterContractEndpoint): string[] {
  switch (endpoint) {
    case 'GET /api/master/licenses':
      return [
        'ok',
        'companyLicenses',
        'licenses',
        'central',
        'items',
        'count',
        'snapshot',
        'cloudLicenses',
        'localLicenses',
        'localCount',
        'persistence',
        'operationalAuthWired',
        'masterOnly',
        'note',
      ];
    case 'GET /api/master/tenants':
      return ['ok', 'tenants', 'legacyMasterTenants', 'count', 'persistence', 'adapter'];
    case 'GET /api/master/dashboard':
      return ['ok', 'modules', 'summary', 'executive'];
    case 'GET /api/master/summary':
      return ['ok', 'summary', 'executive', 'modules', 'persistence', 'note'];
    case 'GET /api/master/operational-companies':
      return ['ok', 'companies', 'orphans', 'count', 'uninitializedCount'];
    case 'GET /api/master/tenants/:id':
    case 'POST /api/master/tenants':
    case 'PATCH /api/master/tenants/:id':
    case 'POST /api/master/tenants/:id/actions/:action':
      return ['ok', 'tenant'];
    case 'POST /api/master/licenses':
    case 'PATCH /api/master/licenses/:id':
    case 'POST /api/master/licenses/:id/rules':
    case 'POST /api/master/licenses/:id/actions/:action':
      return ['ok', 'license', 'masterOnly'];
  }
}

export function validateLicensesResponse(payload: unknown): MasterContractReport {
  const endpoint: MasterContractEndpoint = 'GET /api/master/licenses';
  const violations: ContractViolation[] = [];
  const counts = {
    central: 0,
    companyLicenses: 0,
    missingValidityCentral: 0,
    missingValidityCompanyLicenses: 0,
  };

  if (!isPlainObject(payload)) {
    violations.push({
      path: '$',
      code: 'INVALID_PAYLOAD',
      message: 'Resposta /licenses deve ser objeto',
    });
    return { endpoint, ok: false, violations, checkedAt: new Date().toISOString(), counts };
  }

  if (payload.ok !== true) {
    violations.push({
      path: '$.ok',
      code: 'OK_NOT_TRUE',
      message: 'ok deve ser true',
      actual: payload.ok,
    });
  }

  const central = requireArray(payload.central ?? payload.items, '$.central|items', violations);
  const companyLicenses = requireArray(
    payload.companyLicenses ?? payload.licenses,
    '$.companyLicenses|licenses',
    violations,
  );

  if (central) {
    counts.central = central.length;
    central.forEach((row, i) => {
      const path = `$.central[${i}].validity`;
      const v = isPlainObject(row) ? row.validity : undefined;
      const rowViolations = validateCommercialLicenseViewState(v, path);
      if (rowViolations.length) counts.missingValidityCentral += 1;
      violations.push(...rowViolations);
    });
  }

  if (companyLicenses) {
    counts.companyLicenses = companyLicenses.length;
    companyLicenses.forEach((row, i) => {
      const path = `$.companyLicenses[${i}].validity`;
      const v = isPlainObject(row) ? row.validity : undefined;
      const rowViolations = validateCommercialLicenseViewState(v, path);
      if (rowViolations.length) counts.missingValidityCompanyLicenses += 1;
      violations.push(...rowViolations);
    });
  }

  return {
    endpoint,
    ok: violations.length === 0,
    violations,
    checkedAt: new Date().toISOString(),
    counts,
  };
}

export function validateTenantsResponse(payload: unknown): MasterContractReport {
  const endpoint: MasterContractEndpoint = 'GET /api/master/tenants';
  const violations: ContractViolation[] = [];
  const counts = { tenants: 0, missingLicenseValidity: 0 };

  if (!isPlainObject(payload)) {
    violations.push({
      path: '$',
      code: 'INVALID_PAYLOAD',
      message: 'Resposta /tenants deve ser objeto',
    });
    return { endpoint, ok: false, violations, checkedAt: new Date().toISOString(), counts };
  }

  if (payload.ok !== true) {
    violations.push({
      path: '$.ok',
      code: 'OK_NOT_TRUE',
      message: 'ok deve ser true',
      actual: payload.ok,
    });
  }

  const tenants = requireArray(payload.tenants, '$.tenants', violations);
  if (tenants) {
    counts.tenants = tenants.length;
    tenants.forEach((row, i) => {
      const path = `$.tenants[${i}].licenseValidity`;
      const v = isPlainObject(row) ? row.licenseValidity : undefined;
      const rowViolations = validateCommercialLicenseViewState(v, path);
      if (rowViolations.length) counts.missingLicenseValidity += 1;
      violations.push(...rowViolations);
    });
  }

  return {
    endpoint,
    ok: violations.length === 0,
    violations,
    checkedAt: new Date().toISOString(),
    counts,
  };
}

export function validateDashboardResponse(payload: unknown): MasterContractReport {
  const endpoint: MasterContractEndpoint = 'GET /api/master/dashboard';
  const violations: ContractViolation[] = [];
  const counts = {
    licenseValidities: 0,
    missingValidityInArray: 0,
  };

  if (!isPlainObject(payload)) {
    violations.push({
      path: '$',
      code: 'INVALID_PAYLOAD',
      message: 'Resposta /dashboard deve ser objeto',
    });
    return { endpoint, ok: false, violations, checkedAt: new Date().toISOString(), counts };
  }

  if (payload.ok !== true) {
    violations.push({
      path: '$.ok',
      code: 'OK_NOT_TRUE',
      message: 'ok deve ser true',
      actual: payload.ok,
    });
  }

  if (!isPlainObject(payload.executive)) {
    violations.push({
      path: '$.executive',
      code: 'MISSING_EXECUTIVE',
      message: 'executive deve ser objeto',
      actual: payload.executive == null ? payload.executive : typeof payload.executive,
    });
    return {
      endpoint,
      ok: false,
      violations,
      checkedAt: new Date().toISOString(),
      counts,
    };
  }

  const exec = payload.executive;
  if (!('licenseValidities' in exec)) {
    violations.push({
      path: '$.executive.licenseValidities',
      code: 'MISSING_FIELD',
      message: 'licenseValidities deve existir (array, mesmo vazio)',
    });
  }
  const list = requireArray(
    exec.licenseValidities ?? [],
    '$.executive.licenseValidities',
    violations,
  );
  if (list) {
    counts.licenseValidities = list.length;
    list.forEach((row, i) => {
      if (!isPlainObject(row)) {
        violations.push({
          path: `$.executive.licenseValidities[${i}]`,
          code: 'INVALID_ROW',
          message: 'item deve ser objeto',
        });
        counts.missingValidityInArray += 1;
        return;
      }
      if (typeof row.licenseId !== 'string' || !row.licenseId) {
        violations.push({
          path: `$.executive.licenseValidities[${i}].licenseId`,
          code: 'MISSING_FIELD',
          message: 'licenseId obrigatório',
        });
      }
      if (typeof row.tenantId !== 'string' || !row.tenantId) {
        violations.push({
          path: `$.executive.licenseValidities[${i}].tenantId`,
          code: 'MISSING_FIELD',
          message: 'tenantId obrigatório',
        });
      }
      const rowViolations = validateCommercialLicenseViewState(
        row.validity,
        `$.executive.licenseValidities[${i}].validity`,
      );
      if (rowViolations.length) counts.missingValidityInArray += 1;
      violations.push(...rowViolations);
    });
  }

  return {
    endpoint,
    ok: violations.length === 0,
    violations,
    checkedAt: new Date().toISOString(),
    counts,
  };
}

export function validateOperationalCompaniesResponse(payload: unknown): MasterContractReport {
  const endpoint: MasterContractEndpoint = 'GET /api/master/operational-companies';
  const violations: ContractViolation[] = [];
  const counts = { companies: 0, missingLicenseValidity: 0 };

  if (!isPlainObject(payload)) {
    violations.push({
      path: '$',
      code: 'INVALID_PAYLOAD',
      message: 'Resposta /operational-companies deve ser objeto',
    });
    return { endpoint, ok: false, violations, checkedAt: new Date().toISOString(), counts };
  }

  if (payload.ok !== true) {
    violations.push({
      path: '$.ok',
      code: 'OK_NOT_TRUE',
      message: 'ok deve ser true',
      actual: payload.ok,
    });
  }

  const companies = requireArray(payload.companies, '$.companies', violations);
  if (companies) {
    counts.companies = companies.length;
    companies.forEach((row, i) => {
      const path = `$.companies[${i}].licenseValidity`;
      const v = isPlainObject(row) ? row.licenseValidity : undefined;
      const rowViolations = validateCommercialLicenseViewState(v, path);
      if (rowViolations.length) counts.missingLicenseValidity += 1;
      violations.push(...rowViolations);
    });
  }

  return {
    endpoint,
    ok: violations.length === 0,
    violations,
    checkedAt: new Date().toISOString(),
    counts,
  };
}

/** GET/POST/PATCH tenant — payload com { ok, tenant } (ou result com tenant). */
export function validateTenantResponse(
  payload: unknown,
  endpoint: MasterContractEndpoint = 'GET /api/master/tenants/:id',
): MasterContractReport {
  const violations: ContractViolation[] = [];
  const counts = { tenants: 0, missingLicenseValidity: 0 };

  if (!isPlainObject(payload)) {
    violations.push({
      path: '$',
      code: 'INVALID_PAYLOAD',
      message: 'Resposta de tenant deve ser objeto',
    });
    return { endpoint, ok: false, violations, checkedAt: new Date().toISOString(), counts };
  }

  const tenant = isPlainObject(payload.tenant) ? payload.tenant : null;
  if (!tenant) {
    violations.push({
      path: '$.tenant',
      code: 'MISSING_TENANT',
      message: 'tenant deve ser objeto',
    });
    return {
      endpoint,
      ok: false,
      violations,
      checkedAt: new Date().toISOString(),
      counts,
    };
  }

  counts.tenants = 1;
  const rowViolations = validateCommercialLicenseViewState(
    tenant.licenseValidity,
    '$.tenant.licenseValidity',
  );
  if (rowViolations.length) counts.missingLicenseValidity = 1;
  violations.push(...rowViolations);

  return {
    endpoint,
    ok: violations.length === 0,
    violations,
    checkedAt: new Date().toISOString(),
    counts,
  };
}

/** POST/PATCH license mutations — { ok, license }. */
export function validateLicenseMutationResponse(
  payload: unknown,
  endpoint: MasterContractEndpoint = 'POST /api/master/licenses',
): MasterContractReport {
  const violations: ContractViolation[] = [];
  const counts = { licenses: 0, missingValidity: 0 };

  if (!isPlainObject(payload)) {
    violations.push({
      path: '$',
      code: 'INVALID_PAYLOAD',
      message: 'Resposta de license deve ser objeto',
    });
    return { endpoint, ok: false, violations, checkedAt: new Date().toISOString(), counts };
  }

  const license = isPlainObject(payload.license) ? payload.license : null;
  if (!license) {
    violations.push({
      path: '$.license',
      code: 'MISSING_LICENSE',
      message: 'license deve ser objeto',
    });
    return {
      endpoint,
      ok: false,
      violations,
      checkedAt: new Date().toISOString(),
      counts,
    };
  }

  counts.licenses = 1;
  const rowViolations = validateCommercialLicenseViewState(
    license.validity,
    '$.license.validity',
  );
  if (rowViolations.length) counts.missingValidity = 1;
  violations.push(...rowViolations);

  return {
    endpoint,
    ok: violations.length === 0,
    violations,
    checkedAt: new Date().toISOString(),
    counts,
  };
}

/** GET /summary — executive com licenseValidities (mesmo contrato do dashboard). */
export function validateSummaryResponse(payload: unknown): MasterContractReport {
  const base = validateDashboardResponse(
    isPlainObject(payload)
      ? { ok: payload.ok === true ? true : payload.ok, executive: payload.executive }
      : payload,
  );
  return {
    ...base,
    endpoint: 'GET /api/master/summary',
  };
}

export function validateMasterEndpointResponse(
  endpoint: MasterContractEndpoint,
  payload: unknown,
): MasterContractReport {
  switch (endpoint) {
    case 'GET /api/master/licenses':
      return validateLicensesResponse(payload);
    case 'GET /api/master/tenants':
      return validateTenantsResponse(payload);
    case 'GET /api/master/tenants/:id':
    case 'POST /api/master/tenants':
    case 'PATCH /api/master/tenants/:id':
    case 'POST /api/master/tenants/:id/actions/:action':
      return validateTenantResponse(payload, endpoint);
    case 'GET /api/master/dashboard':
      return validateDashboardResponse(payload);
    case 'GET /api/master/summary':
      return validateSummaryResponse(payload);
    case 'GET /api/master/operational-companies':
      return validateOperationalCompaniesResponse(payload);
    case 'POST /api/master/licenses':
    case 'PATCH /api/master/licenses/:id':
    case 'POST /api/master/licenses/:id/rules':
    case 'POST /api/master/licenses/:id/actions/:action':
      return validateLicenseMutationResponse(payload, endpoint);
  }
}
