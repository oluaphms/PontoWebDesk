/**
 * Projeção unidirecional Master → SaaS (public.companies).
 * Nunca lê alterações comerciais vindas do SaaS para o Master.
 * No bloqueio (false→true), incrementa company_session_version e invalida JWTs.
 */
import { pool } from '../../db/index.js';
import { logger } from '../../logger/logger.js';
import { deriveCommercialProjection } from './deriveCommercialProjection.js';
import type { CommercialProjectionSnapshot } from './commercialProjection.types.js';
import type { ManagedTenant } from '../tenantManager/tenantManager.types.js';
import type { CompanyLicense } from '../licenseManager/types.js';
import type { SubscriptionProps } from '../subscriptions/subscription.types.js';
import { readPreviousCommercialBlocked } from './companySessionRevocation.js';

export type CommercialProjectionInput = {
  tenant: ManagedTenant;
  license?: CompanyLicense | null;
  subscription?: SubscriptionProps | null;
  paymentStatus?: string | null;
};

export type CommercialProjectionOptions = {
  /**
   * Em ações de bloqueio administrativo, a projeção é parte do resultado:
   * ausência de vínculo/schema/empresa ou falha SQL deve rejeitar a ação.
   */
  required?: boolean;
};

async function nextRevision(companyId: string): Promise<number> {
  const result = await pool.queryMaster<{ commercial_revision: number | null }>(
    `select commercial_revision
       from public.companies
      where id::text = $1
      limit 1`,
    [companyId],
  );
  const current = Number(result.rows[0]?.commercial_revision ?? 0);
  return Number.isFinite(current) ? current + 1 : 1;
}

async function companyExists(companyId: string): Promise<boolean> {
  const result = await pool.queryMaster<{ id: string }>(
    `select id::text as id from public.companies where id::text = $1 limit 1`,
    [companyId],
  );
  return Boolean(result.rows[0]?.id);
}

export async function projectCommercialStateToSaas(
  input: CommercialProjectionInput,
  options: CommercialProjectionOptions = {},
): Promise<CommercialProjectionSnapshot | null> {
  const companyId = String(
    input.tenant.operationalCompanyId || input.tenant.id || '',
  ).trim();
  if (!companyId) return null;

  // Tenant Master sem vínculo operacional ainda não pode receber projeção.
  if (!input.tenant.operationalCompanyId && companyId.startsWith('tn_')) {
    if (options.required) {
      throw new Error('COMMERCIAL_PROJECTION_OPERATIONAL_COMPANY_REQUIRED');
    }
    return null;
  }

  let exists = false;
  try {
    exists = await companyExists(companyId);
  } catch (error) {
    logger.warn({
      module: 'master.commercial',
      action: 'COMMERCIAL_PROJECTION_LOOKUP_FAILED',
      message: 'Falha ao localizar empresa operacional para projeção',
      companyId,
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    if (options.required) throw error;
    return null;
  }
  if (!exists) {
    logger.info({
      module: 'master.commercial',
      action: 'COMMERCIAL_PROJECTION_SKIPPED_NO_COMPANY',
      message: 'Projeção comercial ignorada: companies.id inexistente',
      meta: { companyId },
    });
    if (options.required) {
      throw new Error('COMMERCIAL_PROJECTION_COMPANY_NOT_FOUND');
    }
    return null;
  }

  let revision = 1;
  try {
    revision = await nextRevision(companyId);
  } catch (error) {
    if (options.required) throw error;
    logger.warn({
      module: 'master.commercial',
      action: 'COMMERCIAL_PROJECTION_REVISION_FALLBACK',
      message: 'Falha ao ler revisão comercial; usando revisão inicial',
      companyId,
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
  }
  const meta = input.license?.meta || {};
  const maxUsersRaw = meta.maxEmployees ?? meta.maxUsers;
  const maxDevicesRaw = meta.maxDevices;
  const snapshot = deriveCommercialProjection(
    {
      tenantId: companyId,
      tenantStatus: input.tenant.status,
      tenantPlan: input.tenant.plan,
      tenantMode: input.tenant.mode,
      storageMaxGb: input.tenant.storage?.maxGb ?? null,
      licenseStatus: input.license?.status ?? null,
      licenseStartsAt: input.license?.startsAt ?? null,
      licenseExpiresAt: input.license?.expiresAt ?? null,
      licenseBlockedReason: input.license?.blockedReason ?? null,
      licenseBlockLogin: input.license?.rules?.blockLogin ?? null,
      licenseMaxUsers:
        maxUsersRaw != null && Number.isFinite(Number(maxUsersRaw))
          ? Number(maxUsersRaw)
          : null,
      licenseMaxDevices:
        maxDevicesRaw != null && Number.isFinite(Number(maxDevicesRaw))
          ? Number(maxDevicesRaw)
          : null,
      subscriptionStatus: input.subscription?.status ?? null,
      paymentStatus: input.paymentStatus ?? null,
    },
    revision,
  );

  try {
    const { applyCommercialProjectionToCompany } = await import(
      '../operationalCompany/OperationalCompanyWriter.js'
    );
    const result = await applyCommercialProjectionToCompany(companyId, snapshot);
    if (result.rowCount !== 1) {
      throw new Error('COMMERCIAL_PROJECTION_COMPANY_NOT_FOUND');
    }

    logger.info({
      module: 'master.commercial',
      action: 'COMMERCIAL_PROJECTION_APPLIED',
      message: 'Projeção comercial Master → SaaS aplicada',
      companyId,
      meta: {
        plan: snapshot.plan,
        commercialBlocked: snapshot.commercialBlocked,
        licenseStatus: snapshot.licenseStatus,
        revision: snapshot.commercialRevision,
        sessionsRevoked: snapshot.commercialBlocked,
      },
    });
  } catch (error) {
    // Colunas podem ainda não existir (migration pendente) — não quebra o Master.
    logger.warn({
      module: 'master.commercial',
      action: 'COMMERCIAL_PROJECTION_FAILED',
      message: 'Falha ao projetar estado comercial (migration 019/020 pode estar pendente)',
      companyId,
      meta: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    if (options.required) throw error;
    return snapshot;
  }

  return snapshot;
}

/**
 * Reavalia vigência da licença e reprojeta se o bloqueio derivado mudou.
 * Chamado no gate comercial (login / sessão) — sem cron.
 * Não altera autenticação: apenas atualiza companies.commercial_blocked.
 */
export async function ensureCommercialValidityForOperationalCompany(
  companyId: string,
): Promise<CommercialProjectionSnapshot | null> {
  const id = String(companyId || '').trim();
  if (!id) return null;

  try {
    const { MasterPlatformService } = await import(
      '../../services/master/masterPlatformService.js'
    );
    const tenants = await MasterPlatformService.getTenantsService().list();
    const tenant =
      tenants.find((t) => String(t.operationalCompanyId || '').trim() === id) ||
      tenants.find((t) => t.id === id) ||
      null;
    if (!tenant) return null;

    const license = await MasterPlatformService.getLicenseManager()
      .resolveForTenant(tenant)
      .catch(() => null);

    let subscription: SubscriptionProps | null = null;
    try {
      subscription = (await MasterPlatformService.getLifecycle().findCurrentByTenant(
        tenant.id,
      )) as unknown as SubscriptionProps | null;
    } catch {
      subscription = null;
    }

    const previouslyBlocked = await readPreviousCommercialBlocked(id);
    let previousReason: string | null = null;
    try {
      const reasonRow = await pool.queryMaster<{ commercial_block_reason: string | null }>(
        `select commercial_block_reason from public.companies where id::text = $1 limit 1`,
        [id],
      );
      previousReason = reasonRow.rows[0]?.commercial_block_reason
        ? String(reasonRow.rows[0].commercial_block_reason)
        : null;
    } catch {
      previousReason = null;
    }

    const meta = license?.meta || {};
    const maxUsersRaw = meta.maxEmployees ?? meta.maxUsers;
    const maxDevicesRaw = meta.maxDevices;
    const derived = deriveCommercialProjection({
      tenantId: id,
      tenantStatus: tenant.status,
      tenantPlan: tenant.plan,
      tenantMode: tenant.mode,
      storageMaxGb: tenant.storage?.maxGb ?? null,
      licenseStatus: license?.status ?? null,
      licenseStartsAt: license?.startsAt ?? null,
      licenseExpiresAt: license?.expiresAt ?? null,
      licenseBlockedReason: license?.blockedReason ?? null,
      licenseBlockLogin: license?.rules?.blockLogin ?? null,
      licenseMaxUsers:
        maxUsersRaw != null && Number.isFinite(Number(maxUsersRaw))
          ? Number(maxUsersRaw)
          : null,
      licenseMaxDevices:
        maxDevicesRaw != null && Number.isFinite(Number(maxDevicesRaw))
          ? Number(maxDevicesRaw)
          : null,
      subscriptionStatus: subscription?.status ?? null,
      paymentStatus: null,
    });

    const changed =
      derived.commercialBlocked !== previouslyBlocked ||
      String(derived.commercialBlockReason || '') !== String(previousReason || '');
    if (!changed) {
      return {
        ...derived,
        commercialRevision: 0,
      };
    }

    const snapshot = await projectCommercialStateToSaas({
      tenant,
      license,
      subscription,
    });
    if (!snapshot) return null;

    const validityReasons = new Set([
      'license_not_started',
      'license_validity_expired',
      'license_expired_by_master',
    ]);
    const nowBlocked = snapshot.commercialBlocked;
    const reason = snapshot.commercialBlockReason;

    if (!previouslyBlocked && nowBlocked && reason && validityReasons.has(reason)) {
      logger.info({
        module: 'master.commercial',
        action: 'LICENSE_VALIDITY_AUTO_BLOCK',
        message: 'Bloqueio automático por vigência de licença',
        companyId: id,
        meta: { reason, tenantId: tenant.id },
      });
      try {
        const { MasterApiServices } = await import('../api/services/index.js');
        await MasterApiServices.recordAudit(null, {
          actorUserId: null,
          actorEmail: 'system:license-validity',
          action: 'LICENSE_VALIDITY_AUTO_BLOCK',
          resource: 'licenses',
          message: `Bloqueio automático por vigência (${reason})`,
          companyId: id,
          companyName: tenant.company?.name ?? null,
          before: { commercialBlocked: false },
          after: { commercialBlocked: true, reason },
          meta: {
            licenseId: license?.id ?? null,
            startsAt: license?.startsAt ?? null,
            expiresAt: license?.expiresAt ?? null,
          },
        });
      } catch {
        /* auditoria best-effort */
      }
    }

    if (previouslyBlocked && !nowBlocked) {
      const wasValidityBlock =
        previousReason != null && validityReasons.has(String(previousReason));
      if (wasValidityBlock) {
        logger.info({
          module: 'master.commercial',
          action: 'LICENSE_VALIDITY_AUTO_UNBLOCK',
          message: 'Desbloqueio automático por vigência de licença',
          companyId: id,
          meta: { tenantId: tenant.id },
        });
        try {
          const { MasterApiServices } = await import('../api/services/index.js');
          await MasterApiServices.recordAudit(null, {
            actorUserId: null,
            actorEmail: 'system:license-validity',
            action: 'LICENSE_VALIDITY_AUTO_UNBLOCK',
            resource: 'licenses',
            message: 'Desbloqueio automático por vigência restaurada',
            companyId: id,
            companyName: tenant.company?.name ?? null,
            before: { commercialBlocked: true, reason: previousReason },
            after: { commercialBlocked: false },
            meta: {
              licenseId: license?.id ?? null,
              startsAt: license?.startsAt ?? null,
              expiresAt: license?.expiresAt ?? null,
            },
          });
        } catch {
          /* auditoria best-effort */
        }
      }
    }

    return snapshot;
  } catch (error) {
    logger.warn({
      module: 'master.commercial',
      action: 'LICENSE_VALIDITY_ENSURE_FAILED',
      message: 'Falha ao reavaliar vigência no gate comercial',
      companyId: id,
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}
