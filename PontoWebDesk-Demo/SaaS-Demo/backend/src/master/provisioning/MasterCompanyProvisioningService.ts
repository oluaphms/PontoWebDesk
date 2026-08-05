/**
 * Provisionamento unificado Master → operacional (Fase 6.6+).
 *
 * Única origem de criação de public.companies no produto:
 * cadastro no Painel Master cria companies + domínio comercial.
 * O Sistema Operacional NÃO cria empresas.
 */
import { randomUUID } from 'node:crypto';
import { CommercialJourneyService } from '../journey/CommercialJourneyService.js';
import { CommercialCrmService } from '../crm/CommercialCrmService.js';
import { SubscriptionFinanceService } from '../subscriptionFinance/SubscriptionFinanceService.js';
import { SubscriptionNotificationService } from '../subscriptionNotifications/SubscriptionNotificationService.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import type { CreateManagedTenantInput, ManagedTenant } from '../tenantManager/tenantManager.types.js';
import { checkDatabaseConnection, pool } from '../../db/index.js';
import { logger } from '../../logger/logger.js';
import { OperationalCompanyDiscoveryService } from '../operationalDiscovery/OperationalCompanyDiscoveryService.js';
import { MasterDomainTransaction } from '../tx/MasterDomainTransaction.js';

export type MasterProvisionResult = {
  provisionCorrelationId: string;
  tenant: ManagedTenant;
  operationalCompanyId: string;
  provisioned: boolean;
  journeyState: string | null;
  subscriptionId: string | null;
  licenseId: string | null;
  crmInitialized: boolean;
  notificationsInitialized: boolean;
  financeEntryId: string | null;
  adminProvisioned: boolean;
  message: string;
};

type ProvisionActor = {
  userId?: string | null;
  email?: string | null;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

type ProvisionRollbackState = {
  tenantId: string | null;
  operationalCompanyId: string;
  companyName: string;
  adminEmail: string | null;
  adminUserId: string | null;
  subscriptionId: string | null;
  licenseId: string | null;
  /** Quando true, a company operacional já existia (CNPJ) e NÃO deve ser apagada no rollback. */
  preserveOperationalCompany?: boolean;
};

type OnboardingRollbackRow = {
  subscription_id: string | null;
  license_id: string | null;
  admin_user_id: string | null;
};

type ExistingOnboardingByOperationalCompanyRow = {
  id: string;
  master_tenant_id: string;
  operational_company_id: string;
  customer_id: string | null;
  subscription_id: string | null;
  license_id: string | null;
  admin_email: string | null;
};

type PgDiagnostic = {
  sqlstate: string | null;
  message: string | null;
  detail: string | null;
  hint: string | null;
  context: string | null;
  routine: string | null;
  schema: string | null;
  table: string | null;
  column: string | null;
  position: string | null;
  internalPosition: string | null;
  internalQuery: string | null;
  severity: string | null;
  file: string | null;
  line: string | null;
};

const provisionLocks = new Map<string, Promise<void>>();

function extractPgDiagnostic(error: unknown): PgDiagnostic {
  const pg = error as Record<string, unknown>;
  return {
    sqlstate: typeof pg?.code === 'string' ? pg.code : null,
    message: error instanceof Error ? error.message : typeof pg?.message === 'string' ? pg.message : null,
    detail: typeof pg?.detail === 'string' ? pg.detail : null,
    hint: typeof pg?.hint === 'string' ? pg.hint : null,
    context: typeof pg?.where === 'string' ? pg.where : null,
    routine: typeof pg?.routine === 'string' ? pg.routine : null,
    schema: typeof pg?.schema === 'string' ? pg.schema : null,
    table: typeof pg?.table === 'string' ? pg.table : null,
    column: typeof pg?.column === 'string' ? pg.column : null,
    position: typeof pg?.position === 'string' ? pg.position : null,
    internalPosition: typeof pg?.internalPosition === 'string' ? pg.internalPosition : null,
    internalQuery: typeof pg?.internalQuery === 'string' ? pg.internalQuery : null,
    severity: typeof pg?.severity === 'string' ? pg.severity : null,
    file: typeof pg?.file === 'string' ? pg.file : null,
    line: typeof pg?.line === 'string' ? pg.line : null,
  };
}

function logProvisionSqlFailure(input: {
  moduleAction: string;
  correlationId: string;
  step: string;
  sqlOrigin: string;
  companyId?: string | null;
  tenantId?: string | null;
  error: unknown;
}): void {
  logger.error({
    module: 'master.provisioning',
    action: input.moduleAction,
    message: 'Falha SQL no fluxo de criação de empresa (diagnóstico detalhado).',
    companyId: input.companyId ?? null,
    meta: {
      provisionCorrelationId: input.correlationId,
      step: input.step,
      sqlOrigin: input.sqlOrigin,
      tenantId: input.tenantId ?? null,
      pg: extractPgDiagnostic(input.error),
      nodeStack: input.error instanceof Error ? input.error.stack : String(input.error),
    },
    error: input.error,
  });
}

export class MasterProvisioningError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MasterProvisioningError';
  }
}

function normalizeCnpj(raw: string | null | undefined): string | null {
  const digits = String(raw || '').replace(/\D+/g, '');
  return digits.length >= 8 ? digits : null;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

/** Timeout do mutex in-process — evita lock preso se a Promise anterior travar. */
const PROVISION_LOCK_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.MASTER_PROVISION_LOCK_TIMEOUT_MS || 120_000),
);

async function withProvisionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return fn();
  const current = provisionLocks.get(normalizedKey) ?? Promise.resolve();
  const gate: { release?: () => void } = {};
  const next = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  const chained = current.then(() => next);
  provisionLocks.set(normalizedKey, chained);
  try {
    await Promise.race([
      current,
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => {
          reject(
            new MasterProvisioningError(
              503,
              'PROVISION_LOCK_TIMEOUT',
              `Timeout aguardando lock de provisionamento (${normalizedKey})`,
            ),
          );
        }, PROVISION_LOCK_TIMEOUT_MS);
        // Evita manter o timer se current resolver antes.
        void current.finally(() => clearTimeout(t));
      }),
    ]);
  } catch (error) {
    gate.release?.();
    if (provisionLocks.get(normalizedKey) === chained) {
      provisionLocks.delete(normalizedKey);
    }
    throw error;
  }
  try {
    return await fn();
  } finally {
    gate.release?.();
    if (provisionLocks.get(normalizedKey) === chained) {
      provisionLocks.delete(normalizedKey);
    }
  }
}

async function withProvisionLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const ordered = [...new Set(keys.map((item) => item.trim()).filter(Boolean))].sort();
  const run = async (index: number): Promise<T> => {
    if (index >= ordered.length) return fn();
    return withProvisionLock(ordered[index], () => run(index + 1));
  };
  return run(0);
}

function appendProvisionAudit(input: {
  action:
    | 'PROVISION_STARTED'
    | 'PROVISION_STEP'
    | 'PROVISION_COMPLETED'
    | 'PROVISION_ROLLBACK_STARTED'
    | 'PROVISION_ROLLBACK_COMPLETED'
    | 'PROVISION_FAILED'
    | 'OPERATIONAL_COMPANY_REPAIRED';
  correlationId: string;
  actor?: ProvisionActor;
  companyId?: string | null;
  companyName?: string | null;
  message: string;
  meta?: Record<string, unknown>;
}): void {
  MasterPlatformService.getAudit().append({
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
    actorRole: input.actor?.role ?? null,
    ip: input.actor?.ip ?? null,
    userAgent: input.actor?.userAgent ?? null,
    action: input.action,
    resource: 'provisioning',
    companyId: input.companyId ?? null,
    companyName: input.companyName ?? null,
    message: input.message,
    meta: {
      provisionCorrelationId: input.correlationId,
      ...(input.meta || {}),
    },
  });
}

function isWorkShiftsBootstrapCompatError(error: unknown): boolean {
  const pg = error as Record<string, unknown>;
  const message = String(
    error instanceof Error ? error.message : pg?.message || '',
  ).toLowerCase();
  const context = String(pg?.where || '').toLowerCase();
  const internalQuery = String(pg?.internalQuery || '').toLowerCase();
  const bootstrapContext =
    context.includes('pwd_bootstrap_company_defaults') ||
    internalQuery.includes('insert into public.work_shifts') ||
    internalQuery.includes('pwd_bootstrap_company_defaults');
  // Schema legado (entry_time) ou bug array || text → "malformed array literal: start_time".
  const legacyEntryTime =
    message.includes('entry_time') && message.includes('work_shifts') && bootstrapContext;
  const malformedArrayLiteral =
    message.includes('malformed array literal') &&
    (message.includes('start_time') ||
      message.includes('end_time') ||
      message.includes('entry_time') ||
      message.includes('exit_time') ||
      message.includes('12:00') ||
      message.includes('13:00') ||
      bootstrapContext);
  return legacyEntryTime || malformedArrayLiteral;
}

async function enforceWorkShiftsBootstrapCompatibility(): Promise<void> {
  await pool.queryMaster(`
CREATE OR REPLACE FUNCTION public.pwd_bootstrap_company_defaults(p_company_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id text := btrim(coalesce(p_company_id, ''));
  v_shift_id uuid;
  v_columns text[];
  v_values text[];
  v_sql text;
BEGIN
  IF v_company_id = '' THEN
    RETURN;
  END IF;

  IF to_regclass('public.work_shifts') IS NOT NULL THEN
    SELECT id INTO v_shift_id
      FROM public.work_shifts
     WHERE company_id::text = v_company_id
       AND name IN ('Jornada 44h Semanais', 'Segunda a Sexta')
     ORDER BY created_at NULLS LAST, id
     LIMIT 1;

    IF v_shift_id IS NULL THEN
      v_columns := ARRAY['company_id', 'name'];
      v_values := ARRAY['$1::uuid', '$2'];

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'start_time'
      ) THEN
        v_columns := array_append(v_columns, 'start_time');
        v_values := array_append(v_values, '$3::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'end_time'
      ) THEN
        v_columns := array_append(v_columns, 'end_time');
        v_values := array_append(v_values, '$4::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'entry_time'
      ) THEN
        v_columns := array_append(v_columns, 'entry_time');
        v_values := array_append(v_values, '$3::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'exit_time'
      ) THEN
        v_columns := array_append(v_columns, 'exit_time');
        v_values := array_append(v_values, '$4::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_start'
      ) THEN
        v_columns := array_append(v_columns, 'break_start');
        v_values := array_append(v_values, '''12:00''::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_end'
      ) THEN
        v_columns := array_append(v_columns, 'break_end');
        v_values := array_append(v_values, '''13:00''::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_start_time'
      ) THEN
        v_columns := array_append(v_columns, 'break_start_time');
        v_values := array_append(v_values, '''12:00''::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_end_time'
      ) THEN
        v_columns := array_append(v_columns, 'break_end_time');
        v_values := array_append(v_values, '''13:00''::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_duration'
      ) THEN
        v_columns := array_append(v_columns, 'break_duration');
        v_values := array_append(v_values, '60');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_minutes'
      ) THEN
        v_columns := array_append(v_columns, 'break_minutes');
        v_values := array_append(v_values, '60');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'tolerance_minutes'
      ) THEN
        v_columns := array_append(v_columns, 'tolerance_minutes');
        v_values := array_append(v_values, '10');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'active'
      ) THEN
        v_columns := array_append(v_columns, 'active');
        v_values := array_append(v_values, 'true');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'ativo'
      ) THEN
        v_columns := array_append(v_columns, 'ativo');
        v_values := array_append(v_values, 'true');
      END IF;

      v_sql := format(
        'INSERT INTO public.work_shifts (%s) VALUES (%s) RETURNING id',
        array_to_string(v_columns, ', '),
        array_to_string(v_values, ', ')
      );
      EXECUTE v_sql USING v_company_id, 'Jornada 44h Semanais', '08:00', '18:00' INTO v_shift_id;
    END IF;
  END IF;

  IF to_regclass('public.schedules') IS NOT NULL THEN
    EXECUTE
      'INSERT INTO public.schedules (company_id, name, days, shift_id)
       SELECT $1::uuid, $2, ARRAY[1,2,3,4,5]::integer[], $3
       WHERE NOT EXISTS (
         SELECT 1
           FROM public.schedules
          WHERE company_id::text = $1::text
            AND lower(btrim(name)) = lower($2)
       )'
    USING v_company_id, 'Segunda a Sexta', v_shift_id;
  END IF;
END;
$$;`);
}

async function ensureNotificationPreferences(
  tenantId: string,
  companyId: string,
): Promise<boolean> {
  try {
    const notifications = new SubscriptionNotificationService();
    await notifications.updatePreferences(
      tenantId,
      {
        receiveEmail: true,
        notifyDueIn7: true,
        notifyDueIn3: true,
        notifyDueToday: true,
        notifyAfterBlock: true,
      },
      null,
    );
    await pool.queryMaster(
      `UPDATE public.master_subscription_notification_preferences
          SET company_id = $2, updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId, companyId],
    );
    return true;
  } catch {
    return false;
  }
}

async function ensureInitialFinanceEntry(companyId: string): Promise<string | null> {
  try {
    const finance = new SubscriptionFinanceService();
    const existing = await finance.listCompanyTimeline(companyId).catch(() => []);
    if (existing.length > 0) return existing[0].id;
    const entry = await finance.createPayment({
      companyId,
      status: 'PENDING',
      description: 'Ciclo comercial inicial (cadastro Master)',
    });
    return entry.id;
  } catch {
    return null;
  }
}

async function rollbackProvision(input: {
  state: ProvisionRollbackState;
  correlationId: string;
  actor?: ProvisionActor;
  error?: unknown;
  /** Exclusão deliberada Master: falhas não são engolidas. */
  strict?: boolean;
}): Promise<void> {
  const state = input.state;
  const companyId = String(state.operationalCompanyId || '').trim();
  const tenantId = String(state.tenantId || '').trim();
  const adminEmail = String(state.adminEmail || '').trim().toLowerCase();
  const strict = Boolean(input.strict);

  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      if (!strict) return;
      const detail = err instanceof Error ? err.message : String(err);
      throw new MasterProvisioningError(
        500,
        'PURGE_INCOMPLETE',
        `Falha ao remover ${label}: ${detail}`,
      );
    }
  };

  appendProvisionAudit({
    action: 'PROVISION_ROLLBACK_STARTED',
    correlationId: input.correlationId,
    actor: input.actor,
    companyId,
    companyName: state.companyName,
    message: 'Rollback de provisionamento iniciado',
    meta: {
      tenantId: tenantId || null,
      subscriptionId: state.subscriptionId,
      licenseId: state.licenseId,
      strict,
      reason: input.error instanceof Error ? input.error.message : String(input.error || 'unknown_error'),
    },
  });

  // Ordem FK: notifications → finance → license → subscription → demais.
  if (tenantId) {
    await run('subscription_notifications', () =>
      pool.queryMaster(`DELETE FROM public.master_subscription_notifications WHERE tenant_id = $1`, [
        tenantId,
      ]),
    );
    await run('subscription_notification_preferences', () =>
      pool.queryMaster(
        `DELETE FROM public.master_subscription_notification_preferences WHERE tenant_id = $1`,
        [tenantId],
      ),
    );
    await run('subscription_finance_entries', () =>
      pool.queryMaster(`DELETE FROM public.master_subscription_finance_entries WHERE tenant_id = $1`, [
        tenantId,
      ]),
    );
  }

  if (state.licenseId) {
    await run('license', () =>
      MasterPlatformService.getLicenseManager().action(state.licenseId!, 'delete'),
    );
  } else if (tenantId) {
    await run('license_by_tenant', async () => {
      const existingLicense = await MasterPlatformService.getLicenseManager()
        .getByTenantId(tenantId)
        .catch(() => null);
      if (existingLicense?.id) {
        await MasterPlatformService.getLicenseManager().action(existingLicense.id, 'delete');
      }
    });
  }

  if (state.subscriptionId) {
    await run('subscription', () =>
      MasterPlatformService.getLifecycle().remove(state.subscriptionId!),
    );
  } else if (tenantId) {
    await run('subscription_by_tenant', async () => {
      const existingSubscription = await MasterPlatformService.getLifecycle()
        .findCurrentByTenant(tenantId)
        .catch(() => null);
      if (existingSubscription?.id) {
        await MasterPlatformService.getLifecycle().remove(existingSubscription.id);
      }
    });
  }

  if (companyId && adminEmail) {
    await run('admin_user', () =>
      pool.queryMaster(
        `DELETE FROM public.users
          WHERE company_id::text = $1
            AND lower(trim(email)) = $2`,
        [companyId, adminEmail],
      ),
    );
  } else if (state.adminUserId) {
    await run('admin_user_by_id', () =>
      pool.queryMaster(`DELETE FROM public.users WHERE id::text = $1`, [state.adminUserId]),
    );
  }

  if (tenantId) {
    await run('commercial_onboardings', () =>
      pool.queryMaster(`DELETE FROM public.master_commercial_onboardings WHERE master_tenant_id = $1`, [
        tenantId,
      ]),
    );
    await run('crm_profiles', () =>
      pool.queryMaster(`DELETE FROM public.master_crm_profiles WHERE master_tenant_id = $1`, [tenantId]),
    );
  }

  if (tenantId) {
    await run('master_tenant', () => MasterPlatformService.getTenantsService().delete(tenantId));
  }

  const preserveOperationalCompany = Boolean(state.preserveOperationalCompany);
  // Ao remover a company, limpa TODOS os users do tenant operacional (não só o admin),
  // evitando órfãos user→company inexistente após purge/deleteTenant.
  if (companyId && !preserveOperationalCompany) {
    await run('operational_users', () =>
      pool.queryMaster(`DELETE FROM public.users WHERE company_id::text = $1`, [companyId]),
    );
    await run('operational_company', async () => {
      const { deleteOperationalCompany } = await import(
        '../operationalCompany/OperationalCompanyWriter.js'
      );
      await deleteOperationalCompany(companyId);
    });
  }

  if (strict && tenantId) {
    const leftovers = await pool.queryMaster<{ kind: string; cnt: string }>(
      `select 'licenses' as kind, count(*)::text as cnt from public.master_licenses where tenant_id = $1
       union all
       select 'finance', count(*)::text from public.master_subscription_finance_entries where tenant_id = $1
       union all
       select 'notifications', count(*)::text from public.master_subscription_notifications where tenant_id = $1
       union all
       select 'onboardings', count(*)::text from public.master_commercial_onboardings where master_tenant_id = $1
       union all
       select 'tenant', count(*)::text from public.master_tenants where id::text = $1`,
      [tenantId],
    );
    const companyOrphans =
      companyId && !preserveOperationalCompany
        ? await pool.queryMaster<{ kind: string; cnt: string }>(
            `select 'users' as kind, count(*)::text as cnt from public.users where company_id::text = $1
             union all
             select 'companies', count(*)::text from public.companies where id::text = $1`,
            [companyId],
          )
        : { rows: [] as Array<{ kind: string; cnt: string }> };
    const orphans = [...leftovers.rows, ...companyOrphans.rows].filter((r) => Number(r.cnt) > 0);
    if (orphans.length > 0) {
      throw new MasterProvisioningError(
        500,
        'PURGE_ORPHANS_REMAIN',
        `Exclusão incompleta — órfãos: ${orphans.map((o) => `${o.kind}=${o.cnt}`).join(', ')}`,
      );
    }
  }

  appendProvisionAudit({
    action: 'PROVISION_ROLLBACK_COMPLETED',
    correlationId: input.correlationId,
    actor: input.actor,
    companyId,
    companyName: state.companyName,
    message: 'Rollback de provisionamento concluído',
    meta: {
      tenantId: tenantId || null,
      operationalCompanyRemovedLast: !preserveOperationalCompany,
      preserveOperationalCompany,
      strict,
    },
  });
}

async function findExistingTenantByIdempotency(input: {
  operationalCompanyId: string;
  cnpj: string | null;
}): Promise<ManagedTenant | null> {
  const tenants = await MasterPlatformService.getTenantsService().list();
  const byOperationalCompany = tenants.find(
    (tenant) =>
      String(tenant.operationalCompanyId || '').trim() === input.operationalCompanyId,
  );
  if (byOperationalCompany) return byOperationalCompany;
  if (!input.cnpj) return null;
  const byCnpj = tenants.find((tenant) => normalizeCnpj(tenant.company.document) === input.cnpj);
  return byCnpj ?? null;
}

async function readOnboardingRollbackState(tenantId: string): Promise<OnboardingRollbackRow | null> {
  const result = await pool.queryMaster<OnboardingRollbackRow>(
    `SELECT subscription_id, license_id, admin_user_id
       FROM public.master_commercial_onboardings
      WHERE master_tenant_id = $1
      LIMIT 1`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

async function findOnboardingByOperationalCompanyId(
  operationalCompanyId: string,
): Promise<ExistingOnboardingByOperationalCompanyRow | null> {
  const result = await pool.queryMaster<ExistingOnboardingByOperationalCompanyRow>(
    `SELECT id, master_tenant_id, operational_company_id, customer_id, subscription_id, license_id, admin_email
       FROM public.master_commercial_onboardings
      WHERE operational_company_id::text = $1
      LIMIT 1`,
    [operationalCompanyId],
  );
  return result.rows[0] ?? null;
}

async function rebindOnboardingToTenant(input: {
  onboardingId: string;
  tenantId: string;
  operationalCompanyId: string;
  adminEmail: string;
}): Promise<void> {
  await pool.queryMaster(
    `UPDATE public.master_commercial_onboardings
        SET master_tenant_id = $2,
            operational_company_id = $3,
            customer_id = coalesce(customer_id, $4),
            admin_email = coalesce(nullif(trim($5), ''), admin_email),
            updated_at = now()
      WHERE id = $1`,
    [
      input.onboardingId,
      input.tenantId,
      input.operationalCompanyId,
      `cust_${input.tenantId}`,
      input.adminEmail,
    ],
  );
}

/**
 * Wrapper de provisionamento → writer canônico (`OperationalCompanyWriter.upsertFromTenant`).
 * Mantém retry de compatibilidade work_shifts; a SQL de companies vive só no writer.
 */
export async function insertOperationalCompanyFromTenant(
  tenant: ManagedTenant,
  operationalCompanyId: string,
): Promise<void> {
  const { upsertOperationalCompanyFromTenant } = await import(
    '../operationalCompany/OperationalCompanyWriter.js'
  );
  try {
    await upsertOperationalCompanyFromTenant({ tenant, operationalCompanyId });
  } catch (error) {
    if (!isWorkShiftsBootstrapCompatError(error)) throw error;
    logger.warn({
      module: 'master.provisioning',
      action: 'MASTER_PROVISION_BOOTSTRAP_COMPAT_REPAIR',
      message:
        'Detectado bootstrap incompatível em work_shifts. Aplicando compatibilidade e repetindo insert de companies.',
      companyId: operationalCompanyId,
      meta: {
        tenantId: tenant.id,
      },
    });
    await enforceWorkShiftsBootstrapCompatibility();
    await upsertOperationalCompanyFromTenant({ tenant, operationalCompanyId });
  }
}

export const MasterCompanyProvisioningService = {
  /**
   * Cadastro Master completo:
   * master_tenants + companies + assinatura/licença/CRM/financeiro/notificações + admin.
   */
  async createFullyProvisioned(
    input: CreateManagedTenantInput,
    actor?: ProvisionActor,
  ): Promise<MasterProvisionResult> {
    const dbOk = await checkDatabaseConnection();
    if (!dbOk) {
      throw new MasterProvisioningError(
        503,
        'OPERATIONAL_DATABASE_UNAVAILABLE',
        'Banco operacional indisponível. A criação da empresa foi cancelada sem persistir dados parciais.',
      );
    }

    const tenants = MasterPlatformService.getTenantsService();
    let operationalCompanyId =
      String(input.operationalCompanyId || '').trim() || randomUUID();
    const normalizedCnpj = normalizeCnpj(input.company?.document);
    const existingOperationalCompany = !String(input.operationalCompanyId || '').trim() && normalizedCnpj
      ? await OperationalCompanyDiscoveryService.findOperationalCompanyByDocument(normalizedCnpj).catch(
          (error) => {
            logger.warn({
              module: 'master.provisioning',
              action: 'MASTER_PROVISION_CNPJ_DISCOVERY_FAILED',
              message: 'Falha ao descobrir empresa operacional por CNPJ; seguirá com novo operationalCompanyId.',
              meta: {
                cnpj: normalizedCnpj,
                error: error instanceof Error ? error.message : String(error || 'unknown'),
              },
            });
            return null;
          },
        )
      : null;
    if (existingOperationalCompany?.id) {
      operationalCompanyId = existingOperationalCompany.id;
    }
    const provisionCorrelationId = randomUUID();
    const startedAt = Date.now();
    const companyName = String(input.company?.name || '').trim() || 'Empresa';
    const lockKeys = dedupeStrings([
      operationalCompanyId ? `operational_company_id:${operationalCompanyId}` : null,
      normalizedCnpj ? `cnpj:${normalizedCnpj}` : null,
    ]);
    let tenant: ManagedTenant | null = null;
    let journeyState: string | null = null;
    let subscriptionId: string | null = null;
    let licenseId: string | null = null;
    let adminProvisioned = false;
    let notificationsInitialized = false;
    let financeEntryId: string | null = null;
    let lastStep = 'start';
    let lastSqlOrigin = 'none';

    return withProvisionLocks(lockKeys, async () => {
      // Garante bootstrap work_shifts compatível (start_time vs entry_time / array_append).
      await enforceWorkShiftsBootstrapCompatibility().catch(() => undefined);

      appendProvisionAudit({
        action: 'PROVISION_STARTED',
        correlationId: provisionCorrelationId,
        actor,
        companyId: operationalCompanyId,
        companyName,
        message: 'Provisionamento Master iniciado',
        meta: {
          cnpj: normalizedCnpj,
          reusedOperationalCompanyId: existingOperationalCompany?.id ?? null,
          masterPersistence: MasterPlatformService.getPersistence(),
        },
      });
      const existingTenant = await findExistingTenantByIdempotency({
        operationalCompanyId,
        cnpj: normalizedCnpj,
      });
      if (existingTenant) {
        appendProvisionAudit({
          action: 'PROVISION_STEP',
          correlationId: provisionCorrelationId,
          actor,
          companyId: operationalCompanyId,
          companyName: existingTenant.company.name,
          message: 'Idempotência detectou tenant existente',
          meta: { step: 'idempotency_reuse', tenantId: existingTenant.id },
        });
        const existingJourney = await CommercialJourneyService.provision(
          existingTenant.id,
          `master-create:${existingTenant.id}`,
          { userId: actor?.userId ?? null, email: actor?.email ?? null },
          { sendFirstAccess: false },
        );
        const invite = await CommercialJourneyService.resendFirstAccess(existingTenant.id).catch(
          () => null,
        );
        const reusedResult: MasterProvisionResult = {
          provisionCorrelationId,
          tenant: await tenants.get(existingTenant.id),
          operationalCompanyId:
            existingJourney.operationalCompanyId || existingTenant.operationalCompanyId || operationalCompanyId,
          provisioned: true,
          journeyState: invite?.state ?? existingJourney.state,
          subscriptionId: existingJourney.subscriptionId,
          licenseId: existingJourney.licenseId,
          crmInitialized: true,
          notificationsInitialized: await ensureNotificationPreferences(
            existingTenant.id,
            existingTenant.operationalCompanyId || operationalCompanyId,
          ),
          financeEntryId: await ensureInitialFinanceEntry(
            existingTenant.operationalCompanyId || operationalCompanyId,
          ),
          adminProvisioned: Boolean(existingJourney.adminUserId),
          message: 'Requisição idempotente reutilizou empresa já provisionada.',
        };
        appendProvisionAudit({
          action: 'PROVISION_COMPLETED',
          correlationId: provisionCorrelationId,
          actor,
          companyId: reusedResult.operationalCompanyId,
          companyName: reusedResult.tenant.company.name,
          message: 'Provisionamento idempotente concluído sem duplicidade',
          meta: {
            tenantId: reusedResult.tenant.id,
            durationMs: Date.now() - startedAt,
            idempotentReuse: true,
          },
        });
        return reusedResult;
      }

      try {
      return await MasterDomainTransaction.run(async () => {
      // 1) Cria tenant comercial (memory/postgres conforme MASTER_PERSISTENCE)
      MasterDomainTransaction.step('create_tenant');
      lastStep = 'create_tenant';
      lastSqlOrigin = 'MasterPlatformService.getTenantsService().create';
      tenant = await tenants.create({
        ...input,
        operationalCompanyId,
        // draft no formulário → trial comercial ao provisionar.
        status:
          !input.status || input.status === 'draft' ? 'trial' : input.status,
      });
      appendProvisionAudit({
        action: 'PROVISION_STEP',
        correlationId: provisionCorrelationId,
        actor,
        companyId: operationalCompanyId,
        companyName: tenant.company.name,
        message: 'Tenant Master criado',
        meta: { step: 'create_tenant', tenantId: tenant.id },
      });

      // 2) Vincula company operacional existente (descoberta por CNPJ) OU cria se não existir
      if (existingOperationalCompany?.id) {
        if (tenant.operationalCompanyId !== existingOperationalCompany.id) {
          lastStep = 'link_existing_operational_company';
          lastSqlOrigin = 'MasterPlatformService.getTenantsService().update';
          tenant = await tenants.update(tenant.id, {
            operationalCompanyId: existingOperationalCompany.id,
          });
        }
        appendProvisionAudit({
          action: 'PROVISION_STEP',
          correlationId: provisionCorrelationId,
          actor,
          companyId: existingOperationalCompany.id,
          companyName: tenant.company.name,
          message: 'Tenant Master vinculado a empresa operacional existente',
          meta: {
            step: 'link_existing_operational_company',
            tenantId: tenant.id,
            discoveryField: 'cnpj',
            existingOperationalCompanyId: existingOperationalCompany.id,
          },
        });
      } else {
        MasterDomainTransaction.step('create_company');
        lastStep = 'insert_operational_company';
        lastSqlOrigin =
          'MasterCompanyProvisioningService.insertOperationalCompanyFromTenant -> INSERT INTO public.companies (trigger chain)';
        await insertOperationalCompanyFromTenant(tenant, operationalCompanyId);
        if (tenant.operationalCompanyId !== operationalCompanyId) {
          lastStep = 'sync_operational_company_id';
          lastSqlOrigin = 'MasterPlatformService.getTenantsService().update';
          tenant = await tenants.update(tenant.id, { operationalCompanyId });
        }
      }
      appendProvisionAudit({
        action: 'PROVISION_STEP',
        correlationId: provisionCorrelationId,
        actor,
        companyId: existingOperationalCompany?.id ?? operationalCompanyId,
        companyName: tenant.company.name,
        message: existingOperationalCompany?.id
          ? 'Empresa operacional existente reutilizada (sem novo INSERT em companies)'
          : 'Empresa operacional criada/atualizada',
        meta: {
          step: existingOperationalCompany?.id
            ? 'reuse_operational_company'
            : 'insert_operational_company',
          tenantId: tenant.id,
          discoveryField: existingOperationalCompany?.id ? 'cnpj' : null,
        },
      });

      // 3) Jornada obrigatória: assinatura, licença, admin, convite, projeção.
      lastStep = 'reuse_or_create_onboarding';
      lastSqlOrigin = 'pool.queryMaster(select/update master_commercial_onboardings by operational_company_id)';
      const existingOnboardingForOperational = await findOnboardingByOperationalCompanyId(
        operationalCompanyId,
      );
      if (existingOnboardingForOperational) {
        if (existingOnboardingForOperational.master_tenant_id !== tenant.id) {
          await rebindOnboardingToTenant({
            onboardingId: existingOnboardingForOperational.id,
            tenantId: tenant.id,
            operationalCompanyId,
            adminEmail: input.admin?.email ?? '',
          });
          appendProvisionAudit({
            action: 'PROVISION_STEP',
            correlationId: provisionCorrelationId,
            actor,
            companyId: operationalCompanyId,
            companyName: tenant.company.name,
            message: 'Onboarding comercial existente reutilizado por operational_company_id',
            meta: {
              step: 'reuse_existing_onboarding',
              onboardingId: existingOnboardingForOperational.id,
              previousTenantId: existingOnboardingForOperational.master_tenant_id,
              tenantId: tenant.id,
            },
          });
        } else {
          appendProvisionAudit({
            action: 'PROVISION_STEP',
            correlationId: provisionCorrelationId,
            actor,
            companyId: operationalCompanyId,
            companyName: tenant.company.name,
            message: 'Onboarding comercial já estava vinculado ao tenant atual',
            meta: {
              step: 'reuse_existing_onboarding_same_tenant',
              onboardingId: existingOnboardingForOperational.id,
              tenantId: tenant.id,
            },
          });
        }
      }

      lastStep = 'mandatory_journey';
      lastSqlOrigin = 'CommercialJourneyService.provision';
      MasterDomainTransaction.step('create_subscription');
      MasterDomainTransaction.step('create_license');
      const journey = await CommercialJourneyService.provision(
        tenant.id,
        `master-create:${tenant.id}`,
        { userId: actor?.userId ?? null, email: actor?.email ?? null },
        { sendFirstAccess: false },
      );
      journeyState = journey.state;
      subscriptionId = journey.subscriptionId;
      licenseId = journey.licenseId;
      adminProvisioned = Boolean(journey.adminUserId);
      appendProvisionAudit({
        action: 'PROVISION_STEP',
        correlationId: provisionCorrelationId,
        actor,
        companyId: operationalCompanyId,
        companyName: tenant.company.name,
        message: 'Jornada obrigatória concluída',
        meta: {
          step: 'mandatory_journey',
          tenantId: tenant.id,
          subscriptionId,
          licenseId,
          adminUserId: journey.adminUserId ?? null,
        },
      });
      if (!subscriptionId || !licenseId || !adminProvisioned) {
        throw new MasterProvisioningError(
          500,
          'MASTER_PROVISION_INCOMPLETE',
          'Provisionamento incompleto: assinatura, licença ou administrador não foram concluídos.',
        );
      }

      tenant = await tenants.get(tenant.id);

      // 4) Etapas compensáveis (não derrubam criação obrigatória)
      lastStep = 'compensable_crm_snapshot';
      lastSqlOrigin = 'CommercialCrmService.getSnapshot';
      await CommercialCrmService.getSnapshot(tenant.id).catch(() => null);
      lastStep = 'compensable_notification_preferences';
      lastSqlOrigin = 'SubscriptionNotificationService.updatePreferences + pool.queryMaster(update preferences)';
      notificationsInitialized = await ensureNotificationPreferences(
        tenant.id,
        operationalCompanyId,
      );
      lastStep = 'compensable_initial_finance';
      lastSqlOrigin = 'SubscriptionFinanceService.createPayment';
      financeEntryId = await ensureInitialFinanceEntry(operationalCompanyId);
      // Convite (SMTP) fica FORA da TX — ver bloco após MasterDomainTransaction.run.
      MasterDomainTransaction.step('provision_core_committed');

      const successResult: MasterProvisionResult = {
        provisionCorrelationId,
        tenant,
        operationalCompanyId,
        provisioned: true,
        journeyState,
        subscriptionId,
        licenseId,
        crmInitialized: true,
        notificationsInitialized,
        financeEntryId,
        adminProvisioned,
        message:
          'Empresa operacional e domínio comercial criados pelo Painel Master (sem duplicidade).',
      };
      appendProvisionAudit({
        action: 'PROVISION_COMPLETED',
        correlationId: provisionCorrelationId,
        actor,
        companyId: operationalCompanyId,
        companyName: tenant.company.name,
        message: 'Provisionamento concluído com sucesso',
        meta: {
          tenantId: tenant.id,
          subscriptionId,
          licenseId,
          durationMs: Date.now() - startedAt,
          notificationsInitialized,
          financeEntryId,
          inviteDeferred: true,
        },
      });
      return successResult;
      }).then(async (successResult) => {
        // Side-effect externo (fora da TX de domínio).
        lastStep = 'compensable_resend_first_access';
        lastSqlOrigin = 'CommercialJourneyService.resendFirstAccess';
        const invite = await CommercialJourneyService.resendFirstAccess(
          successResult.tenant.id,
        ).catch(() => null);
        if (invite) {
          successResult.journeyState = invite.state;
        }
        return successResult;
      });
    } catch (error) {
      logProvisionSqlFailure({
        moduleAction: 'MASTER_PROVISION_SQL_FAILURE',
        correlationId: provisionCorrelationId,
        step: lastStep,
        sqlOrigin: lastSqlOrigin,
        companyId: operationalCompanyId,
        tenantId: tenant?.id ?? null,
        error,
      });
      const onboardingState = tenant?.id
        ? await readOnboardingRollbackState(tenant.id).catch(() => null)
        : null;
      appendProvisionAudit({
        action: 'PROVISION_FAILED',
        correlationId: provisionCorrelationId,
        actor,
        companyId: operationalCompanyId,
        companyName,
        message: 'Provisionamento falhou',
        meta: {
          tenantId: tenant?.id ?? null,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        },
      });
      await rollbackProvision({
        state: {
          tenantId: tenant?.id ?? null,
          operationalCompanyId,
          companyName,
          adminEmail: input.admin?.email ?? null,
          adminUserId: onboardingState?.admin_user_id ?? null,
          subscriptionId: subscriptionId ?? onboardingState?.subscription_id ?? null,
          licenseId: licenseId ?? onboardingState?.license_id ?? null,
          preserveOperationalCompany: Boolean(existingOperationalCompany?.id),
        },
        correlationId: provisionCorrelationId,
        actor,
        error,
      });
      throw error;
    }
    });
  },

  /**
   * Exclusão deliberada Master (limpeza de teste / remoção administrativa).
   * Reutiliza o mesmo caminho de rollback do provisionamento e remove a company operacional
   * criada pelo cadastro Master.
   */
  async purgeFullyProvisioned(
    tenantId: string,
    actor?: ProvisionActor,
  ): Promise<{
    tenantId: string;
    operationalCompanyId: string | null;
    companyName: string;
    alreadyDeleted?: boolean;
  }> {
    const id = String(tenantId || '').trim();
    if (!id) {
      throw new MasterProvisioningError(400, 'VALIDATION_ERROR', 'tenantId is required');
    }

    let tenant: ManagedTenant;
    try {
      tenant = await MasterPlatformService.getTenantsService().get(id);
    } catch {
      // Idempotente: segunda exclusão / retry pós-crash após tenant já removido.
      return {
        tenantId: id,
        operationalCompanyId: null,
        companyName: 'already_deleted',
        alreadyDeleted: true,
      };
    }

    const operationalCompanyId = String(tenant.operationalCompanyId || '').trim();
    const companyName = String(tenant.company?.name || '').trim() || 'Empresa';
    const onboarding = await readOnboardingRollbackState(id).catch(() => null);
    const correlationId = randomUUID();

    // Limpa faturas/pagamentos Master vinculados ao tenant (quando existirem).
    const purgeBilling = async (label: string, sql: string, params: unknown[]) => {
      try {
        await pool.queryMaster(sql, params);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new MasterProvisioningError(
          500,
          'PURGE_INCOMPLETE',
          `Falha ao remover ${label}: ${detail}`,
        );
      }
    };

    return MasterDomainTransaction.run(async () => {
      MasterDomainTransaction.step('purge_billing');
      await purgeBilling(
        'pix_charges',
        `DELETE FROM public.master_pix_charges
          WHERE payment_id IN (
            SELECT p.id FROM public.master_payments p
            INNER JOIN public.master_invoices i ON i.id = p.invoice_id
            WHERE i.tenant_id = $1
          )
          OR invoice_id IN (
            SELECT id FROM public.master_invoices WHERE tenant_id = $1
          )`,
        [id],
      );
      await purgeBilling(
        'payments',
        `DELETE FROM public.master_payments
          WHERE invoice_id IN (
            SELECT id FROM public.master_invoices WHERE tenant_id = $1
          )`,
        [id],
      );
      await purgeBilling(
        'invoices',
        `DELETE FROM public.master_invoices WHERE tenant_id = $1`,
        [id],
      );

      MasterDomainTransaction.step('purge_domain');
      await rollbackProvision({
        state: {
          tenantId: id,
          operationalCompanyId: operationalCompanyId || id,
          companyName,
          adminEmail: tenant.admin?.email ?? null,
          adminUserId: onboarding?.admin_user_id ?? null,
          subscriptionId: onboarding?.subscription_id ?? null,
          licenseId: onboarding?.license_id ?? null,
          preserveOperationalCompany: false,
        },
        correlationId,
        actor,
        error: null,
        strict: true,
      });

      return {
        tenantId: id,
        operationalCompanyId: operationalCompanyId || null,
        companyName,
      };
    });
  },

  /**
   * Reparo controlado: recria SOMENTE a linha faltante em public.companies
   * via writer canônico (`insertOperationalCompanyFromTenant` → OperationalCompanyWriter).
   *
   * Não recria usuários, licenças, assinaturas, onboarding, CRM ou billing.
   * Não altera IDs. Não roda no login (somente chamada explícita / script).
   */
  async repairMissingOperationalCompany(
    tenantId: string,
    actor?: ProvisionActor,
  ): Promise<{
    repaired: boolean;
    alreadyPresent: boolean;
    tenantId: string;
    operationalCompanyId: string;
    companyName: string;
    commercialProjected: boolean;
  }> {
    const id = String(tenantId || '').trim();
    if (!id) {
      throw new MasterProvisioningError(400, 'VALIDATION_ERROR', 'tenantId is required');
    }
    const tenant = await MasterPlatformService.getTenantsService().get(id);
    const operationalCompanyId = String(tenant.operationalCompanyId || '').trim();
    if (!operationalCompanyId) {
      throw new MasterProvisioningError(
        400,
        'OPERATIONAL_COMPANY_ID_MISSING',
        'Tenant sem operational_company_id — não há id canônico para reparar.',
      );
    }
    const companyName = String(tenant.company?.name || '').trim() || 'Empresa';

    const existing = await pool.queryMaster<{ id: string }>(
      `select id::text as id from public.companies where id::text = $1 limit 1`,
      [operationalCompanyId],
    );
    if (existing.rows[0]?.id) {
      logger.info({
        module: 'master.provisioning',
        action: 'OPERATIONAL_COMPANY_REPAIR_SKIPPED',
        message: 'Company operacional já existe — reparo desnecessário',
        companyId: operationalCompanyId,
        meta: { tenantId: id },
      });
      return {
        repaired: false,
        alreadyPresent: true,
        tenantId: id,
        operationalCompanyId,
        companyName,
        commercialProjected: false,
      };
    }

    await insertOperationalCompanyFromTenant(tenant, operationalCompanyId);

    let commercialProjected = false;
    try {
      const { projectCommercialStateToSaas } = await import(
        '../commercial/CommercialProjectionService.js'
      );
      const license = await MasterPlatformService.getLicenseManager()
        .getByTenantId(id)
        .catch(() => null);
      let subscription = null;
      try {
        subscription = await MasterPlatformService.getLifecycle().findCurrentByTenant(id);
      } catch {
        subscription = null;
      }
      const snap = await projectCommercialStateToSaas({
        tenant,
        license,
        subscription: subscription as never,
      });
      commercialProjected = Boolean(snap);
    } catch (error) {
      logger.warn({
        module: 'master.provisioning',
        action: 'OPERATIONAL_COMPANY_REPAIR_PROJECTION_SOFT_FAIL',
        message: 'Company recriada; projeção comercial best-effort falhou',
        companyId: operationalCompanyId,
        meta: {
          tenantId: id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }

    appendProvisionAudit({
      action: 'OPERATIONAL_COMPANY_REPAIRED',
      correlationId: randomUUID(),
      actor,
      companyId: operationalCompanyId,
      companyName,
      message: 'Linha public.companies recriada a partir de master_tenants (reparo controlado)',
      meta: {
        tenantId: id,
        commercialProjected,
        reusedWriter: 'insertOperationalCompanyFromTenant',
      },
    });

    logger.info({
      module: 'master.provisioning',
      action: 'OPERATIONAL_COMPANY_REPAIRED',
      message: 'Company operacional recriada com writer canônico de provisionamento',
      companyId: operationalCompanyId,
      meta: { tenantId: id, commercialProjected },
    });

    return {
      repaired: true,
      alreadyPresent: false,
      tenantId: id,
      operationalCompanyId,
      companyName,
      commercialProjected,
    };
  },
};
