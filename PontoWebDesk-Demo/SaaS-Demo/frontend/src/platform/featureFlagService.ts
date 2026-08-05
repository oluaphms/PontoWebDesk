/**
 * FeatureFlagService — único ponto para flags operacionais e de implantação.
 *
 * Flags operacionais `VITE_OP_*` preservam defaults atuais.
 * Flags de plataforma (cloudSync, multiTenant, …) derivam de Deployment + License.
 */
import { ConfigService } from './configService';
import { DeploymentService } from './deploymentService';
import { LicenseService } from './licenseService';
import type { FeatureFlagContext, PlatformFeatureFlag } from './types';

export type OperationalFeatureName = Extract<
  PlatformFeatureFlag,
  | 'geoConsensus'
  | 'nativeGps'
  | 'realtimeCoordinator'
  | 'geoForensics'
  | 'operationalIncidents'
  | 'scaleMode'
  | 'cosStrictMode'
  | 'mapStaleBlock'
  | 'geoHealthGuard'
>;

export type OperationalFeatureFlagSet = Record<OperationalFeatureName, boolean>;

type TenantOverride = {
  tenantId?: string;
  companyId?: string;
  flags: Partial<OperationalFeatureFlagSet>;
};

const STORAGE_KEY = 'smartponto:op_flags:v1';

const OP_ENV_KEYS: Record<OperationalFeatureName, string> = {
  geoConsensus: 'VITE_OP_GEO_CONSENSUS_ENABLED',
  nativeGps: 'VITE_OP_NATIVE_GPS_ENABLED',
  realtimeCoordinator: 'VITE_OP_REALTIME_COORDINATOR_ENABLED',
  geoForensics: 'VITE_OP_GEO_FORENSICS_ENABLED',
  operationalIncidents: 'VITE_OP_OPERATIONAL_INCIDENTS_ENABLED',
  scaleMode: 'VITE_OP_SCALE_MODE_ENABLED',
  cosStrictMode: 'VITE_OP_COS_STRICT_MODE',
  mapStaleBlock: 'VITE_OP_MAP_STALE_BLOCK_ENABLED',
  geoHealthGuard: 'VITE_OP_GEO_HEALTH_GUARD_ENABLED',
};

const OP_DEFAULTS: OperationalFeatureFlagSet = {
  geoConsensus: false,
  nativeGps: false,
  realtimeCoordinator: true,
  geoForensics: true,
  operationalIncidents: false,
  scaleMode: false,
  cosStrictMode: false,
  mapStaleBlock: true,
  geoHealthGuard: true,
};

let memoizedFlags: OperationalFeatureFlagSet | null = null;
let memoizedOverrides: TenantOverride[] | null = null;

function readOverridesFromStorage(): TenantOverride[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is TenantOverride => !!x && typeof x === 'object' && 'flags' in x);
  } catch {
    return [];
  }
}

function buildOperationalDefaults(): OperationalFeatureFlagSet {
  const out = { ...OP_DEFAULTS };
  (Object.keys(OP_ENV_KEYS) as OperationalFeatureName[]).forEach((name) => {
    out[name] = ConfigService.getBoolean(OP_ENV_KEYS[name], OP_DEFAULTS[name]);
  });
  return out;
}

function resolveOperational(
  feature: OperationalFeatureName,
  context?: FeatureFlagContext,
): boolean {
  if (!memoizedFlags) memoizedFlags = buildOperationalDefaults();
  const base = memoizedFlags[feature];
  if (!memoizedOverrides) memoizedOverrides = readOverridesFromStorage();
  const tenantId = context?.tenantId ?? null;
  const companyId = context?.companyId ?? null;
  const override = memoizedOverrides.find(
    (o) => (tenantId && o.tenantId === tenantId) || (companyId && o.companyId === companyId),
  );
  return override?.flags?.[feature] ?? base;
}

function resolvePlatformFlag(flag: PlatformFeatureFlag): boolean {
  const caps = DeploymentService.getCapabilities();
  switch (flag) {
    case 'cloudSync':
      return caps.enableCloudSync && LicenseService.hasEntitlement('cloud_sync');
    case 'multiTenant':
      return caps.multiTenant && LicenseService.hasEntitlement('multi_tenant');
    case 'repBridge':
      return LicenseService.hasEntitlement('rep_agent');
    case 'localOnlyMode':
      return caps.mode === 'LOCAL';
    case 'hybridAgentRequired':
      return caps.requireRepAgentForLanDevices;
    default:
      return resolveOperational(flag, undefined);
  }
}

export const FeatureFlagService = {
  isEnabled(flag: PlatformFeatureFlag, context?: FeatureFlagContext): boolean {
    if (
      flag === 'cloudSync' ||
      flag === 'multiTenant' ||
      flag === 'repBridge' ||
      flag === 'localOnlyMode' ||
      flag === 'hybridAgentRequired'
    ) {
      return resolvePlatformFlag(flag);
    }
    return resolveOperational(flag, context);
  },

  getOperationalFlags(): OperationalFeatureFlagSet {
    if (!memoizedFlags) memoizedFlags = buildOperationalDefaults();
    return { ...memoizedFlags };
  },

  getOperationalFlag(feature: OperationalFeatureName, context?: FeatureFlagContext): boolean {
    return resolveOperational(feature, context);
  },

  setOperationalOverrides(overrides: TenantOverride[]): void {
    memoizedOverrides = overrides;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      // sem persistência — usa env default
    }
  },

  resetCache(): void {
    memoizedFlags = null;
    memoizedOverrides = null;
  },
};
