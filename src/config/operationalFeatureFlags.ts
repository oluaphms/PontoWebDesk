export type OperationalFeatureName =
  | 'geoConsensus'
  | 'nativeGps'
  | 'realtimeCoordinator'
  | 'geoForensics'
  | 'operationalIncidents'
  | 'scaleMode'
  | 'cosStrictMode'
  | 'mapStaleBlock'
  | 'geoHealthGuard';

export type OperationalFeatureFlagSet = Record<OperationalFeatureName, boolean>;

type TenantOverride = {
  tenantId?: string;
  companyId?: string;
  flags: Partial<OperationalFeatureFlagSet>;
};

const STORAGE_KEY = 'smartponto:op_flags:v1';
let memoizedFlags: OperationalFeatureFlagSet | null = null;
let memoizedOverrides: TenantOverride[] | null = null;

function envBool(key: keyof ImportMetaEnv, defaultValue: boolean): boolean {
  try {
    const raw = import.meta.env[key];
    if (raw == null || String(raw).trim() === '') return defaultValue;
    return !/^(0|false|off|no)$/i.test(String(raw).trim());
  } catch {
    return defaultValue;
  }
}

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

export function getOperationalFeatureFlags(): OperationalFeatureFlagSet {
  if (memoizedFlags) return memoizedFlags;
  memoizedFlags = {
    geoConsensus: envBool('VITE_OP_GEO_CONSENSUS_ENABLED', false),
    nativeGps: envBool('VITE_OP_NATIVE_GPS_ENABLED', false),
    realtimeCoordinator: envBool('VITE_OP_REALTIME_COORDINATOR_ENABLED', true),
    geoForensics: envBool('VITE_OP_GEO_FORENSICS_ENABLED', true),
    operationalIncidents: envBool('VITE_OP_OPERATIONAL_INCIDENTS_ENABLED', false),
    scaleMode: envBool('VITE_OP_SCALE_MODE_ENABLED', false),
    cosStrictMode: envBool('VITE_OP_COS_STRICT_MODE', false),
    mapStaleBlock: envBool('VITE_OP_MAP_STALE_BLOCK_ENABLED', true),
    geoHealthGuard: envBool('VITE_OP_GEO_HEALTH_GUARD_ENABLED', true),
  };
  return memoizedFlags;
}

export function getOperationalFeatureFlag(
  feature: OperationalFeatureName,
  context?: { tenantId?: string | null; companyId?: string | null },
): boolean {
  const base = getOperationalFeatureFlags()[feature];
  if (!memoizedOverrides) memoizedOverrides = readOverridesFromStorage();
  const tenantId = context?.tenantId ?? null;
  const companyId = context?.companyId ?? null;
  const override = memoizedOverrides.find(
    (o) => (tenantId && o.tenantId === tenantId) || (companyId && o.companyId === companyId),
  );
  const value = override?.flags?.[feature] ?? base;
  console.info(value ? '[FEATURE FLAG ENABLED]' : '[FEATURE FLAG DISABLED]', {
    feature,
    tenant_id: tenantId,
    company_id: companyId,
    source: override ? 'tenant_override' : 'env_default',
  });
  return value;
}

export function setOperationalFeatureOverrides(overrides: TenantOverride[]): void {
  memoizedOverrides = overrides;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // fallback seguro: sem persistencia, usa env default
  }
}

export function resetOperationalFeatureFlagCache(): void {
  memoizedFlags = null;
  memoizedOverrides = null;
}

