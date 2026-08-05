/**
 * Fase 6.6 — Tipo de instalação comercial (sem provedor de pagamento).
 *
 * SAAS_WEB  → somente planos mensais (URL SaaS).
 * ON_PREMISE → somente planos anuais (instalação local).
 */

export const INSTALLATION_TYPES = ['SAAS_WEB', 'ON_PREMISE'] as const;
export type InstallationType = (typeof INSTALLATION_TYPES)[number];

export const SAAS_WEB_URL = 'https://pontowebdesk.vercel.app';

/** Ciclo de plano exigido por tipo de instalação. */
export function requiredPlanCycleForInstallation(
  installationType: InstallationType,
): 'MONTHLY' | 'ANNUAL' {
  return installationType === 'ON_PREMISE' ? 'ANNUAL' : 'MONTHLY';
}

export function isInstallationType(value: unknown): value is InstallationType {
  const v = String(value || '')
    .trim()
    .toUpperCase();
  return (INSTALLATION_TYPES as readonly string[]).includes(v);
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

/** Deriva tipo a partir do modo legado SAAS|LOCAL|HYBRID. */
export function installationTypeFromMode(mode: unknown): InstallationType {
  const m = String(mode || '')
    .trim()
    .toUpperCase();
  return m === 'LOCAL' ? 'ON_PREMISE' : 'SAAS_WEB';
}

/** Modo de implantação sugerido pelo tipo (compatibilidade com mode existente). */
export function modeFromInstallationType(
  installationType: InstallationType,
): 'SAAS' | 'LOCAL' {
  return installationType === 'ON_PREMISE' ? 'LOCAL' : 'SAAS';
}

/** Plano comercial (ciclo) sugerido no cadastro. */
export function planCycleFromInstallationType(
  installationType: InstallationType,
): 'MONTHLY' | 'ANNUAL' {
  return requiredPlanCycleForInstallation(installationType);
}

export function assertInstallationPlanCycle(
  installationType: InstallationType,
  cycle: unknown,
): void {
  const required = requiredPlanCycleForInstallation(installationType);
  const c = String(cycle || '')
    .trim()
    .toUpperCase();
  if (c !== required) {
    const msg =
      installationType === 'SAAS_WEB'
        ? 'SAAS_WEB permite somente plano mensal (MONTHLY)'
        : 'ON_PREMISE permite somente plano anual (ANNUAL)';
    const err = new Error(msg);
    (err as Error & { code?: string }).code = 'INVALID_INSTALLATION_PLAN_CYCLE';
    throw err;
  }
}

export function installationTypeLabel(type: InstallationType): string {
  return type === 'ON_PREMISE' ? 'On-premise (instalação local)' : 'SaaS Web';
}
