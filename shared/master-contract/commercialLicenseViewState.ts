/**
 * Contrato tipado único Master ↔ Frontend.
 * Única definição canônica — não espelhar em FE/BE.
 */
export type LicenseValidityPhase = 'scheduled' | 'active' | 'expired';

export type CompanyLicenseDisplayStatus =
  | 'Ativa'
  | 'Agendada'
  | 'Expirada'
  | 'Bloqueada';

/** Estado completo de vigência comercial (API / UI). */
export type CommercialLicenseViewState = {
  phase: LicenseValidityPhase;
  displayStatus: CompanyLicenseDisplayStatus;
  /** Alias de displayStatus para badges/KPIs. */
  statusLabel: CompanyLicenseDisplayStatus;
  shouldBlock: boolean;
  reason: string | null;
  label: string;
  remainingLabel: string;
  daysDelta: number | null;
  daysRemaining: number | null;
  daysExpired: number | null;
  startsAtEffective: string;
  expiresAt: string | null;
  startsToday: boolean;
  expiresToday: boolean;
};

export const COMMERCIAL_VALIDITY_KEYS = [
  'phase',
  'displayStatus',
  'statusLabel',
  'shouldBlock',
  'reason',
  'label',
  'remainingLabel',
  'daysDelta',
  'daysRemaining',
  'daysExpired',
  'startsAtEffective',
  'expiresAt',
  'startsToday',
  'expiresToday',
] as const satisfies ReadonlyArray<keyof CommercialLicenseViewState>;
