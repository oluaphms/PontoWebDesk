/**
 * Fase 6.6 — Tipo de instalação comercial (sem provedor de pagamento).
 * Espelho frontend do módulo backend.
 */

export const INSTALLATION_TYPES = ['SAAS_WEB', 'ON_PREMISE'] as const;
export type InstallationType = (typeof INSTALLATION_TYPES)[number];

export const SAAS_WEB_URL = 'https://pontowebdesk.vercel.app';

export function requiredPlanCycleForInstallation(
  installationType: InstallationType,
): 'MONTHLY' | 'ANNUAL' {
  return installationType === 'ON_PREMISE' ? 'ANNUAL' : 'MONTHLY';
}

export function parseInstallationType(
  value: unknown,
  fallback: InstallationType = 'SAAS_WEB',
): InstallationType {
  const v = String(value || '')
    .trim()
    .toUpperCase();
  if (v === 'ON_PREMISE') return 'ON_PREMISE';
  if (v === 'SAAS_WEB') return 'SAAS_WEB';
  return fallback;
}

export function installationTypeFromMode(mode: unknown): InstallationType {
  const m = String(mode || '')
    .trim()
    .toUpperCase();
  return m === 'LOCAL' ? 'ON_PREMISE' : 'SAAS_WEB';
}

export function modeFromInstallationType(
  installationType: InstallationType,
): 'SAAS' | 'LOCAL' {
  return installationType === 'ON_PREMISE' ? 'LOCAL' : 'SAAS';
}

export function planCycleFromInstallationType(
  installationType: InstallationType,
): 'MONTHLY' | 'ANNUAL' {
  return requiredPlanCycleForInstallation(installationType);
}

export function installationTypeLabel(type: InstallationType): string {
  return type === 'ON_PREMISE' ? 'On-premise (instalação local)' : 'SaaS Web';
}

export function isValidInstallationPlanCycle(
  installationType: InstallationType,
  cycle: string,
): boolean {
  return String(cycle || '').toUpperCase() === requiredPlanCycleForInstallation(installationType);
}
