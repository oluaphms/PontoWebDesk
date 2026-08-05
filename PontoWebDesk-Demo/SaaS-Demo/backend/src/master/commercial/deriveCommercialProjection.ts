/**
 * Deriva o snapshot comercial a partir do estado Master.
 * Precedência de bloqueio:
 * 1) tenant SUSPENDED / BLOCKED / CANCELLED (Fase 6.1)
 * 2) licença Bloqueada / Expirada / blockLogin / fora da vigência (início–fim)
 * 3) assinatura SUSPENDED / CANCELLED / EXPIRED
 */

import { isCompanyStatusBlocking } from '../license/companyLicenseStatus.js';
import { evaluateCommercialLicense } from '../license/licenseValidity.js';
import type {
  CommercialContractedLimits,
  CommercialMode,
  CommercialProjectionSnapshot,
  CommercialProjectionSources,
} from './commercialProjection.types.js';

function mapOperationalPlan(masterPlan: string | null | undefined): 'free' | 'pro' | 'enterprise' {
  const p = String(masterPlan || 'FREE').toUpperCase().trim();
  if (p === 'PRO') return 'pro';
  if (p === 'ENTERPRISE') return 'enterprise';
  return 'free';
}

function normalizeMode(mode: string | null | undefined): CommercialMode {
  const m = String(mode || 'SAAS').toUpperCase().trim();
  if (m === 'LOCAL') return 'LOCAL';
  if (m === 'HYBRID') return 'HYBRID';
  return 'SAAS';
}

function isTenantBlocked(status: string | null | undefined): { blocked: boolean; reason: string | null } {
  if (!isCompanyStatusBlocking(status)) return { blocked: false, reason: null };
  const s = String(status || '').toLowerCase().trim();
  if (s === 'blocked') return { blocked: true, reason: 'tenant_blocked_by_master' };
  if (s === 'suspended') return { blocked: true, reason: 'tenant_suspended_by_master' };
  if (s === 'cancelled') return { blocked: true, reason: 'tenant_cancelled_by_master' };
  return { blocked: true, reason: 'tenant_blocked_by_master' };
}

function isLicenseBlocked(
  status: string | null | undefined,
  blockLogin: boolean | null | undefined,
  blockedReason: string | null | undefined,
  startsAt?: string | null,
  expiresAt?: string | null,
): { blocked: boolean; reason: string | null } {
  const s = String(status || '').trim();
  if (s === 'Bloqueada') {
    return { blocked: true, reason: blockedReason?.trim() || 'license_blocked_by_master' };
  }
  if (s === 'Expirada') {
    return { blocked: true, reason: 'license_expired_by_master' };
  }
  if (blockLogin === true) {
    return { blocked: true, reason: blockedReason?.trim() || 'license_block_login_by_master' };
  }
  // Vigência BRT (sem cron): antes do início ou após 23:59:59 do fim → bloqueio.
  if (startsAt != null || expiresAt != null || s === 'Ativa' || s === 'Trial') {
    const validity = evaluateCommercialLicense({ startsAt, expiresAt });
    if (validity.shouldBlock) {
      return { blocked: true, reason: validity.reason };
    }
  }
  return { blocked: false, reason: null };
}

function isSubscriptionBlocked(status: string | null | undefined): {
  blocked: boolean;
  reason: string | null;
} {
  const s = String(status || '').toUpperCase().trim();
  if (s === 'SUSPENDED') return { blocked: true, reason: 'subscription_suspended_by_master' };
  if (s === 'CANCELLED') return { blocked: true, reason: 'subscription_cancelled_by_master' };
  if (s === 'EXPIRED') return { blocked: true, reason: 'subscription_expired_by_master' };
  return { blocked: false, reason: null };
}

export function deriveCommercialProjection(
  sources: CommercialProjectionSources,
  revision = 1,
): CommercialProjectionSnapshot {
  const tenantBlock = isTenantBlocked(sources.tenantStatus);
  const licenseBlock = isLicenseBlocked(
    sources.licenseStatus,
    sources.licenseBlockLogin,
    sources.licenseBlockedReason,
    sources.licenseStartsAt,
    sources.licenseExpiresAt,
  );
  const subBlock = isSubscriptionBlocked(sources.subscriptionStatus);

  let commercialBlocked = false;
  let commercialBlockReason: string | null = null;
  if (tenantBlock.blocked) {
    commercialBlocked = true;
    commercialBlockReason = tenantBlock.reason;
  } else if (licenseBlock.blocked) {
    commercialBlocked = true;
    commercialBlockReason = licenseBlock.reason;
  } else if (subBlock.blocked) {
    commercialBlocked = true;
    commercialBlockReason = subBlock.reason;
  }

  const limits: CommercialContractedLimits = {
    maxUsers:
      sources.licenseMaxUsers != null && Number.isFinite(Number(sources.licenseMaxUsers))
        ? Math.max(0, Math.floor(Number(sources.licenseMaxUsers)))
        : null,
    maxDevices:
      sources.licenseMaxDevices != null && Number.isFinite(Number(sources.licenseMaxDevices))
        ? Math.max(0, Math.floor(Number(sources.licenseMaxDevices)))
        : null,
    maxStorageGb:
      sources.storageMaxGb != null && Number.isFinite(Number(sources.storageMaxGb))
        ? Number(sources.storageMaxGb)
        : null,
  };

  return {
    companyId: sources.tenantId,
    plan: mapOperationalPlan(sources.tenantPlan),
    commercialPlan: String(sources.tenantPlan || 'FREE').toUpperCase(),
    commercialMode: normalizeMode(sources.tenantMode),
    licenseStatus: String(sources.licenseStatus || 'unknown'),
    licenseExpiresAt: sources.licenseExpiresAt ?? null,
    subscriptionStatus: String(sources.subscriptionStatus || 'unknown'),
    paymentStatus: String(sources.paymentStatus || 'unknown'),
    contractedLimits: limits,
    commercialBlocked,
    commercialBlockReason,
    commercialRevision: revision,
    commercialSource: 'master',
  };
}
