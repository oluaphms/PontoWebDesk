/**
 * LicenseValidator — valida estrutura e vencimento (reportável).
 * Não bloqueia entitlements nesta fase; sem verificação criptográfica de cobrança.
 */
import type { LicensePayload, LicenseRecord, LicenseValidationResult } from '../types';
import {
  ALL_AI_FEATURES,
  ALL_ENTITLEMENTS,
  ALL_INTEGRATIONS,
  ALL_MODULES,
} from './licenseCatalog';

function isExpiredAt(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (expiresAt == null || String(expiresAt).trim() === '') return false;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return false;
  return t < now;
}

function validateArrays(payload: LicensePayload, errors: string[]): void {
  const check = (items: string[], allowed: readonly string[], label: string) => {
    for (const item of items) {
      if (!allowed.includes(item)) errors.push(`${label}_unknown:${item}`);
    }
  };
  check(payload.modules, ALL_MODULES, 'module');
  check(payload.entitlements, ALL_ENTITLEMENTS, 'entitlement');
  check(payload.integrations, ALL_INTEGRATIONS, 'integration');
  check(payload.aiFeatures, ALL_AI_FEATURES, 'ai');
}

export const LicenseValidator = {
  validate(record: LicenseRecord, now = Date.now()): LicenseValidationResult {
    const errors: string[] = [];
    const { payload, source } = record;

    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        status: 'invalid',
        errors: ['payload_missing'],
        expiresAt: null,
        isExpired: false,
      };
    }

    if (!payload.tier) errors.push('tier_missing');
    if (!payload.plan?.trim()) errors.push('plan_missing');
    if (!payload.type) errors.push('type_missing');

    validateArrays(payload, errors);

    if (payload.issuedAt) {
      const issued = Date.parse(payload.issuedAt);
      if (!Number.isFinite(issued)) errors.push('issuedAt_invalid');
    }

    const expiresAt =
      payload.expiresAt == null || String(payload.expiresAt).trim() === ''
        ? null
        : String(payload.expiresAt);
    if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) {
      errors.push('expiresAt_invalid');
    }

    const expired = isExpiredAt(expiresAt, now);

    if (source === 'default_full') {
      return {
        ok: errors.length === 0,
        status: 'default',
        errors,
        expiresAt: null,
        isExpired: false,
      };
    }

    if (source === 'env_payload' && record.rawPayload && errors.includes('payload_missing')) {
      return {
        ok: false,
        status: 'invalid',
        errors,
        expiresAt,
        isExpired: expired,
      };
    }

    if (errors.length > 0) {
      return {
        ok: false,
        status: 'invalid',
        errors,
        expiresAt,
        isExpired: expired,
      };
    }

    if (expired) {
      return {
        ok: true,
        status: 'expired',
        errors: [],
        expiresAt,
        isExpired: true,
      };
    }

    return {
      ok: true,
      status: 'valid',
      errors: [],
      expiresAt,
      isExpired: false,
    };
  },
};
