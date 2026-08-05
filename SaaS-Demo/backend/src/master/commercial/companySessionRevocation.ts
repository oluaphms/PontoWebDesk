/**
 * Revogação imediata de sessões operacionais no bloqueio comercial Master.
 * Usa company_session_version (não requer inventário de JTIs ativos).
 */
import { pool } from '../../db/index.js';
import { logger } from '../../logger/logger.js';
import { tableHasColumn } from '../../db/schemaColumns.js';

export type CompanySessionGate = {
  commercialBlocked: boolean;
  commercialBlockReason: string | null;
  companySessionVersion: number;
};

export class CommercialGateUnavailableError extends Error {
  readonly code = 'COMMERCIAL_GATE_UNAVAILABLE';

  constructor(message = 'Gate comercial da empresa indisponível', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CommercialGateUnavailableError';
  }
}

export function isCommercialGateUnavailableError(
  error: unknown,
): error is CommercialGateUnavailableError {
  return (
    error instanceof CommercialGateUnavailableError ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'COMMERCIAL_GATE_UNAVAILABLE')
  );
}

/** Serializa ensure+read por empresa — evita corrida login × requests paralelos no bump de versão. */
const companyGateLocks = new Map<string, Promise<void>>();

async function withCompanyGateLock<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  const prev = companyGateLocks.get(companyId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => gate);
  companyGateLocks.set(companyId, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (companyGateLocks.get(companyId) === chained) {
      companyGateLocks.delete(companyId);
    }
  }
}

function asBool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s === 'true' || s === 't' || s === '1' || s === 'yes';
}

export async function readCompanySessionGate(
  companyId: string,
): Promise<CompanySessionGate | null> {
  const id = String(companyId || '').trim();
  if (!id) {
    logger.error({
      module: 'master.commercial',
      action: 'COMPANY_GATE_FAIL',
      message: 'Gate comercial: company_id vazio',
      meta: { condition: 'if (!id)', companyId: companyId ?? null },
    });
    return null;
  }

  return withCompanyGateLock(id, () => readCompanySessionGateUnlocked(id));
}

async function readCompanySessionGateUnlocked(
  id: string,
): Promise<CompanySessionGate | null> {
  // Vigência comercial (BRT, sem cron): reavalia e projeta bloqueio/desbloqueio se necessário.
  try {
    const { ensureCommercialValidityForOperationalCompany } = await import(
      './CommercialProjectionService.js'
    );
    await ensureCommercialValidityForOperationalCompany(id);
  } catch {
    /* best-effort — gate segue com estado persistido */
  }

  try {
    const sessionMeta = await pool.queryTrustedBootstrap<{
      current_database: string;
      current_schema: string;
      search_path: string;
    }>(
      `select current_database() as current_database,
              current_schema() as current_schema,
              current_setting('search_path') as search_path`,
    );
    const meta = sessionMeta.rows[0] ?? {
      current_database: null,
      current_schema: null,
      search_path: null,
    };

    logger.error({
      module: 'master.commercial',
      action: 'COMPANY_GATE_START',
      message: 'Início do gate comercial',
      companyId: id,
      meta: {
        user_id: null,
        company_id: id,
        database: meta.current_database,
        schema: meta.current_schema,
        search_path: meta.search_path,
      },
    });

    const logGateQuery = (
      label: string,
      sql: string,
      params: unknown[],
      result: { rowCount: number | null; rows: unknown[] } | null,
      error: unknown = null,
    ) => {
      const pgErr =
        error && typeof error === 'object'
          ? {
              message: error instanceof Error ? error.message : String(error),
              name: error instanceof Error ? error.name : undefined,
              code: (error as { code?: unknown }).code ?? null,
              detail: (error as { detail?: unknown }).detail ?? null,
              hint: (error as { hint?: unknown }).hint ?? null,
              table: (error as { table?: unknown }).table ?? null,
              column: (error as { column?: unknown }).column ?? null,
              schema: (error as { schema?: unknown }).schema ?? null,
              constraint: (error as { constraint?: unknown }).constraint ?? null,
              cause:
                error instanceof Error && error.cause
                  ? error.cause instanceof Error
                    ? { message: error.cause.message, name: error.cause.name, code: (error.cause as { code?: unknown }).code ?? null }
                    : String(error.cause)
                  : null,
            }
          : null;
      logger.error({
        module: 'master.commercial',
        action: 'COMPANY_GATE_QUERY',
        message: label,
        companyId: id,
        meta: {
          sql,
          params,
          rowCount: result?.rowCount ?? null,
          rows: result?.rows ?? null,
          error: pgErr,
        },
      });
    };

    // Schema probe via bootstrap (nunca tenant RLS) — information_schema + companies.
    let hasBlocked = false;
    let hasVersion = false;
    let hasReason = false;
    let hasName = false;
    const probeColumn = async (columnName: string): Promise<boolean> => {
      const probeSql = `select 1 from information_schema.columns
     where table_schema = $1 and table_name = $2 and column_name = $3
     limit 1`;
      const probeParams = ['public', 'companies', columnName];
      try {
        const probeRes = await pool.queryTrustedBootstrap(probeSql, probeParams);
        const ok = (probeRes.rowCount ?? 0) > 0;
        logGateQuery(`schema_probe:${columnName}`, probeSql, probeParams, {
          rowCount: probeRes.rowCount ?? probeRes.rows.length,
          rows: probeRes.rows,
        });
        return ok;
      } catch (error) {
        logGateQuery(`schema_probe:${columnName}`, probeSql, probeParams, null, error);
        throw error;
      }
    };

    hasBlocked = await probeColumn('commercial_blocked');
    hasVersion = await probeColumn('company_session_version');

    if (!hasBlocked || !hasVersion) {
      logger.error({
        module: 'master.commercial',
        action: 'COMPANY_GATE_FAIL',
        message: 'Schema de bloqueio comercial incompleto',
        companyId: id,
        meta: {
          condition: 'if (!hasBlocked || !hasVersion)',
          location: 'readCompanySessionGate:schema_check',
          table: 'public.companies',
          hasBlocked,
          hasVersion,
          requiredColumns: ['commercial_blocked', 'company_session_version'],
        },
      });
      throw new CommercialGateUnavailableError(
        'Schema de bloqueio comercial incompleto (migrations 019/020 obrigatórias)',
      );
    }

    hasReason = await probeColumn('commercial_block_reason');
    hasName = await probeColumn('name');
    // Nunca selecionar companies.status — a coluna comercial é license_status (migração 019).

    const sql = `select commercial_blocked
              ${hasReason ? ', commercial_block_reason' : ', null::text as commercial_block_reason'}
              , company_session_version
              ${hasName ? ', name' : ', null::text as name'}
         from public.companies
        where id::text = $1
        limit 1`;
    const params = [id];
    let result: {
      rowCount: number | null;
      rows: Array<{
        commercial_blocked: boolean | null;
        commercial_block_reason: string | null;
        company_session_version: string | number | null;
        name?: string | null;
      }>;
    };
    try {
      result = await pool.queryTrustedBootstrap(sql, params);
      logGateQuery('gate_select:public.companies', sql, params, {
        rowCount: result.rowCount ?? result.rows.length,
        rows: result.rows,
      });
    } catch (error) {
      logGateQuery('gate_select:public.companies', sql, params, null, error);
      throw error;
    }

    const row = result.rows[0];
    if (!row) {
      logger.error({
        module: 'master.commercial',
        action: 'COMPANY_GATE_FAIL',
        message: 'Empresa não encontrada no gate comercial',
        companyId: id,
        meta: {
          condition: 'if (!row)',
          location: 'readCompanySessionGate:after_select',
          table: 'public.companies',
          rowCount: result.rowCount ?? 0,
        },
      });
      // Integridade: tenant Master aponta para companies.id inexistente — só log, sem auto-reparo no login.
      try {
        const link = await pool.queryMaster<{
          tenant_id: string;
          company_name: string | null;
          admin_email: string | null;
        }>(
          `select id::text as tenant_id,
                  company_name,
                  admin_email
             from public.master_tenants
            where operational_company_id::text = $1
            limit 1`,
          [id],
        );
        const tenant = link.rows[0];
        if (tenant) {
          const userSample = await pool.queryTrustedBootstrap<{ email: string }>(
            `select email from public.users where company_id::text = $1 order by email limit 5`,
            [id],
          );
          logger.error({
            module: 'master.commercial',
            action: 'OPERATIONAL_INTEGRITY_COMPANY_MISSING',
            message:
              'Integridade quebrada: master_tenants.operational_company_id sem linha em public.companies',
            companyId: id,
            meta: {
              reason: 'operational_company_row_missing',
              tenantId: tenant.tenant_id,
              companyName: tenant.company_name,
              adminEmail: tenant.admin_email,
              sampleUserEmails: userSample.rows.map((u) => u.email),
              repairHint:
                'MasterCompanyProvisioningService.repairMissingOperationalCompany(tenantId)',
            },
          });
        }
      } catch {
        /* best-effort integrity probe */
      }
      return null;
    }

    const version = Number(row.company_session_version ?? 0);
    const gate = {
      commercialBlocked: asBool(row.commercial_blocked),
      commercialBlockReason: row.commercial_block_reason
        ? String(row.commercial_block_reason)
        : null,
      companySessionVersion: Number.isFinite(version) ? version : 0,
    };

    logger.error({
      module: 'master.commercial',
      action: 'COMPANY_GATE_COMPANY_FOUND',
      message: 'Empresa localizada no gate comercial',
      companyId: id,
      meta: {
        company_id: id,
        name: row.name ?? null,
        commercial_blocked: row.commercial_blocked,
        commercial_block_reason: row.commercial_block_reason,
        company_session_version: row.company_session_version,
        decisionFields: {
          commercialBlocked: gate.commercialBlocked,
          commercialBlockReason: gate.commercialBlockReason,
          companySessionVersion: gate.companySessionVersion,
        },
      },
    });

    return gate;
  } catch (error) {
    if (isCommercialGateUnavailableError(error)) {
      logger.error({
        module: 'master.commercial',
        action: 'COMPANY_GATE_FAIL',
        message: 'Gate comercial indisponível (erro tipado)',
        companyId: id,
        meta: {
          condition: 'throw CommercialGateUnavailableError',
          location: 'readCompanySessionGate:catch_rethrow',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        error,
      });
      throw error;
    }
    logger.error({
      module: 'master.commercial',
      action: 'COMPANY_GATE_FAIL',
      message: 'Falha ao consultar bloqueio comercial da empresa',
      companyId: id,
      meta: {
        condition: 'catch (error) → wrap CommercialGateUnavailableError',
        location: 'readCompanySessionGate:catch_wrap',
        table: 'public.companies',
        causeMessage: error instanceof Error ? error.message : String(error),
        causeCode: (error as { code?: unknown })?.code ?? null,
      },
      error,
    });
    throw new CommercialGateUnavailableError(
      'Falha ao consultar bloqueio comercial da empresa',
      { cause: error },
    );
  }
}

/**
 * Incrementa company_session_version quando a empresa está (ou fica) bloqueada.
 * Idempotente para true→true: ainda incrementa só se solicitado via bumpOnlyIfTransition.
 */
export async function bumpCompanySessionVersionOnBlock(
  companyId: string,
  opts: { previouslyBlocked: boolean; nowBlocked: boolean },
): Promise<number | null> {
  const id = String(companyId || '').trim();
  if (!id || !opts.nowBlocked) return null;
  // Só bump na transição false → true (evita invalidar login pós-desbloqueio em re-projeções).
  if (opts.previouslyBlocked) return null;

  try {
    const hasVersion = await tableHasColumn('companies', 'company_session_version');
    if (!hasVersion) return null;

    const { bumpOperationalCompanySessionVersion } = await import(
      '../operationalCompany/OperationalCompanyWriter.js'
    );
    const version = await bumpOperationalCompanySessionVersion(id);
    if (version == null) return null;
    logger.info({
      module: 'master.commercial',
      action: 'COMPANY_SESSIONS_REVOKED',
      message: 'Sessões da empresa invalidadas por bloqueio comercial',
      companyId: id,
      meta: { companySessionVersion: version },
    });
    return version;
  } catch (error) {
    logger.warn({
      module: 'master.commercial',
      action: 'COMPANY_SESSION_BUMP_FAILED',
      message: 'Falha ao incrementar company_session_version',
      companyId: id,
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}

export async function readPreviousCommercialBlocked(companyId: string): Promise<boolean> {
  try {
    const hasBlocked = await tableHasColumn('companies', 'commercial_blocked');
    if (!hasBlocked) return false;
    const result = await pool.queryMaster<{ commercial_blocked: boolean | null }>(
      `select commercial_blocked from public.companies where id::text = $1 limit 1`,
      [companyId],
    );
    return result.rows[0]?.commercial_blocked === true;
  } catch {
    return false;
  }
}
