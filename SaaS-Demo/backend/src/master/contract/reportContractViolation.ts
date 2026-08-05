/**
 * Monitoramento estruturado de violações de contrato Master.
 * Não altera o payload — apenas registra (warn) para detecção precoce.
 * Em runtime NÃO lança; throw só com throwOnViolation (testes).
 */
import { logger } from '../../logger/logger.js';
import { getRequestContext } from '../../logger/logger.context.js';
import type { MasterContractEndpoint, MasterContractReport } from './masterEndpointContracts.js';

export type ContractGuardOptions = {
  /** Quando true, também lança Error após o log (útil em testes). Default: false. */
  throwOnViolation?: boolean;
  /** tenantId explícito (quando o handler já conhece o escopo). */
  tenantId?: string | null;
};

function extractTenantIdsFromViolations(
  violations: MasterContractReport['violations'],
): string[] {
  const ids = new Set<string>();
  for (const v of violations) {
    // paths tipicos: $.tenants[0].licenseValidity, $.central[3].validity
    const m = /tenants\[(\d+)\]|companies\[(\d+)\]|central\[(\d+)\]|companyLicenses\[(\d+)\]/.exec(
      v.path,
    );
    void m;
    if (typeof v.actual === 'string' && /^tn_/.test(v.actual)) ids.add(v.actual);
  }
  return [...ids].slice(0, 20);
}

/**
 * Emite log estruturado se o relatório tiver violações.
 * Retorna o mesmo relatório (pass-through).
 */
export function reportMasterContractViolations(
  report: MasterContractReport,
  opts: ContractGuardOptions = {},
): MasterContractReport {
  if (report.ok) return report;

  const ctx = getRequestContext();
  const tenantId =
    opts.tenantId ??
    (typeof ctx?.companyId === 'string' && ctx.companyId ? ctx.companyId : null);
  const tenantIdsFromPaths = extractTenantIdsFromViolations(report.violations);

  logger.warn({
    module: 'master.contract',
    action: 'MASTER_API_CONTRACT_VIOLATION',
    message: `Contrato Master violado em ${report.endpoint} (${report.violations.length} violação(ões))`,
    requestId: ctx?.requestId ?? null,
    correlationId: ctx?.correlationId ?? null,
    companyId: tenantId,
    meta: {
      endpoint: report.endpoint,
      requestId: ctx?.requestId ?? null,
      correlationId: ctx?.correlationId ?? null,
      tenantId,
      tenantIdsSample: tenantIdsFromPaths,
      violationCount: report.violations.length,
      counts: report.counts,
      checkedAt: report.checkedAt,
      // Sem payloads sensíveis — só path/code/message/expected (actual truncado).
      violations: report.violations.slice(0, 50).map((v) => ({
        path: v.path,
        code: v.code,
        message: v.message,
        expected: v.expected,
        actualType:
          v.actual === null
            ? 'null'
            : v.actual === undefined
              ? 'undefined'
              : Array.isArray(v.actual)
                ? 'array'
                : typeof v.actual,
      })),
      truncated: report.violations.length > 50,
    },
  });

  if (opts.throwOnViolation) {
    const first = report.violations[0];
    const err = new Error(
      `MASTER_API_CONTRACT_VIOLATION ${report.endpoint}: ${first?.path} — ${first?.message}`,
    );
    logger.warn({
      module: 'master.contract',
      action: 'MASTER_API_CONTRACT_VIOLATION_THROW',
      message: err.message,
      error: err,
      meta: { endpoint: report.endpoint, path: first?.path ?? null },
    });
    throw err;
  }

  return report;
}

/** Atalho: valida + reporta. */
export function guardMasterContractResponse(
  endpoint: MasterContractEndpoint,
  payload: unknown,
  validate: (payload: unknown) => MasterContractReport,
  opts?: ContractGuardOptions,
): MasterContractReport {
  return reportMasterContractViolations(validate(payload), opts);
}
