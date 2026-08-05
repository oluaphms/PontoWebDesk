/**
 * Features avaliadas pelo LicenseService do Master (Fase 10).
 * Catálogo estável — sem enforcement em telas/API do produto nesta fase.
 */
export type LicenseFeature =
  | 'rep'
  | 'app'
  | 'api'
  | 'dashboard'
  | 'bank_hours'
  | 'schedules'
  | 'multi_company'
  | 'external_api';

export const LICENSE_FEATURES: readonly LicenseFeature[] = [
  'rep',
  'app',
  'api',
  'dashboard',
  'bank_hours',
  'schedules',
  'multi_company',
  'external_api',
] as const;

export type LicenseFeatureSnapshot = Record<LicenseFeature, boolean>;
