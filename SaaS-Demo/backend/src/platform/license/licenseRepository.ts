/**
 * LicenseRepository — lê licença de env (sem banco).
 * Fontes: LICENSE_PAYLOAD (JSON/base64) → LICENSE_TIER → default full.
 */
import { ConfigService } from '../configService.js';
import type { LicensePayload, LicenseRecord, LicenseTier } from '../types.js';
import { buildPayloadForTier } from './licenseCatalog.js';

function parseTier(raw: string): LicenseTier | null {
  const v = raw.trim().toLowerCase();
  if (v === 'full' || v === 'standard' || v === 'trial' || v === 'none') return v;
  return null;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function tryDecodeBase64Json(text: string): unknown | null {
  try {
    const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const decoded = Buffer.from(normalized + pad, 'base64').toString('utf8');
    return tryParseJson(decoded);
  } catch {
    return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function hydratePayload(raw: unknown, fallbackTier: LicenseTier): LicensePayload | null {
  if (!isPlainObject(raw)) return null;
  const tierFromPayload = typeof raw.tier === 'string' ? parseTier(raw.tier) : null;
  const tier = tierFromPayload ?? fallbackTier;
  const base = buildPayloadForTier(tier);

  const asStringArray = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;

  const modules = asStringArray(raw.modules);
  const entitlements = asStringArray(raw.entitlements);
  const integrations = asStringArray(raw.integrations);
  const aiFeatures = asStringArray(raw.aiFeatures);

  const limitsRaw = isPlainObject(raw.limits) ? raw.limits : null;
  const readLimit = (key: string): number | null | undefined => {
    if (!limitsRaw || !(key in limitsRaw)) return undefined;
    const v = limitsRaw[key];
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };

  const maxUsers = readLimit('maxUsers');
  const maxDevices = readLimit('maxDevices');
  const maxCompanies = readLimit('maxCompanies');

  return {
    type:
      raw.type === 'subscription' ||
      raw.type === 'perpetual' ||
      raw.type === 'oem' ||
      raw.type === 'trial' ||
      raw.type === 'unlicensed'
        ? raw.type
        : base.type,
    tier,
    plan: typeof raw.plan === 'string' && raw.plan.trim() ? raw.plan.trim() : base.plan,
    issuedAt: typeof raw.issuedAt === 'string' ? raw.issuedAt : base.issuedAt,
    expiresAt:
      raw.expiresAt === null
        ? null
        : typeof raw.expiresAt === 'string'
          ? raw.expiresAt
          : (base.expiresAt ?? null),
    customerId: typeof raw.customerId === 'string' ? raw.customerId : base.customerId,
    modules: (modules as LicensePayload['modules'] | null) ?? base.modules,
    entitlements: (entitlements as LicensePayload['entitlements'] | null) ?? base.entitlements,
    integrations: (integrations as LicensePayload['integrations'] | null) ?? base.integrations,
    aiFeatures: (aiFeatures as LicensePayload['aiFeatures'] | null) ?? base.aiFeatures,
    limits: {
      maxUsers: maxUsers !== undefined ? maxUsers : base.limits.maxUsers,
      maxDevices: maxDevices !== undefined ? maxDevices : base.limits.maxDevices,
      maxCompanies: maxCompanies !== undefined ? maxCompanies : base.limits.maxCompanies,
    },
    meta: isPlainObject(raw.meta) ? raw.meta : base.meta,
  };
}

function readPayloadText(): string {
  return ConfigService.getString('LICENSE_PAYLOAD', '').trim();
}

function readKey(): string | null {
  const key = ConfigService.getString('LICENSE_KEY', '').trim();
  return key || null;
}

function readExplicitTier(): LicenseTier | null {
  const cfg = ConfigService.getSnapshot();
  if (cfg.licenseTierExplicit) return cfg.licenseTierExplicit;
  return parseTier(ConfigService.getString('LICENSE_TIER', ''));
}

export const LicenseRepository = {
  load(): LicenseRecord {
    const key = readKey();
    const rawPayload = readPayloadText() || null;
    const explicitTier = readExplicitTier();

    if (rawPayload) {
      const parsed = tryParseJson(rawPayload) ?? tryDecodeBase64Json(rawPayload);
      const payload = hydratePayload(parsed, explicitTier ?? 'full');
      if (payload) {
        return {
          key,
          source: 'env_payload',
          payload,
          rawPayload,
        };
      }
    }

    if (explicitTier) {
      return {
        key,
        source: 'env_tier',
        payload: buildPayloadForTier(explicitTier),
        rawPayload: null,
      };
    }

    return {
      key,
      source: 'default_full',
      payload: buildPayloadForTier('full'),
      rawPayload: null,
    };
  },
};
