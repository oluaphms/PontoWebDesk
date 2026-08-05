/**
 * Vigência comercial de licença Master — decisão pura, sem I/O.
 *
 * Calendário: America/Sao_Paulo (BRT).
 * Fim inclusivo: válido até 23:59:59.999 do dia de expiresAt no fuso brasileiro.
 * Sem tolerância pós-vencimento: no primeiro segundo do dia seguinte → bloqueado.
 * Compatibilidade: sem startsAt → considera o dia atual (BRT) como início.
 *
 * Tipos de contrato HTTP (CommercialLicenseViewState etc.) vêm de @pontowebdesk/master-contract.
 */

import type {
  CommercialLicenseViewState,
  CompanyLicenseDisplayStatus,
  LicenseValidityPhase,
} from '@pontowebdesk/master-contract';

export type {
  CommercialLicenseViewState,
  CompanyLicenseDisplayStatus,
  LicenseValidityPhase,
} from '@pontowebdesk/master-contract';

export const LICENSE_VALIDITY_TIMEZONE = 'America/Sao_Paulo';

export type CommercialLicenseEvaluation = {
  phase: LicenseValidityPhase;
  shouldBlock: boolean;
  reason: string | null;
  label: string;
  /** Dias até o fim (ativo) ou até o início (agendada); negativo = dias desde expiração. */
  daysDelta: number | null;
  remainingLabel: string;
  startsAtEffective: string;
  expiresAt: string | null;
};

/** @deprecated Use CommercialLicenseEvaluation — alias de compatibilidade. */
export type LicenseValidityEvaluation = CommercialLicenseEvaluation;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const brazilDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: LICENSE_VALIDITY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Normaliza para YYYY-MM-DD no calendário America/Sao_Paulo.
 * Strings já no formato date-only são tratadas como data de calendário comercial (BRT).
 */
export function toBrazilDateOnly(isoOrDate: string | Date | null | undefined): string | null {
  if (isoOrDate == null || isoOrDate === '') return null;
  if (typeof isoOrDate === 'string' && YMD_RE.test(isoOrDate.trim())) {
    return isoOrDate.trim();
  }
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  return brazilDateFormatter.format(d);
}

/** @deprecated Use toBrazilDateOnly — mantido para imports legados. */
export const toUtcDateOnly = toBrazilDateOnly;

function parseYmdUtcMs(ymd: string): number {
  const [y, m, day] = ymd.split('-').map((n) => Number(n));
  return Date.UTC(y, m - 1, day);
}

function diffCalendarDays(fromYmd: string, toYmd: string): number {
  return Math.round((parseYmdUtcMs(toYmd) - parseYmdUtcMs(fromYmd)) / 86_400_000);
}

/**
 * Função central de vigência comercial.
 * Todos os caminhos (projeção, gate, License Manager, dashboard, UI espelho) devem usá-la.
 */
export function evaluateCommercialLicense(input: {
  startsAt?: string | null;
  expiresAt?: string | null;
  now?: Date;
}): CommercialLicenseEvaluation {
  const now = input.now ?? new Date();
  const today = toBrazilDateOnly(now)!;
  const startsAtEffective = toBrazilDateOnly(input.startsAt) || today;
  const expiresAt = toBrazilDateOnly(input.expiresAt);

  if (diffCalendarDays(today, startsAtEffective) > 0) {
    const daysUntilStart = diffCalendarDays(today, startsAtEffective);
    return {
      phase: 'scheduled',
      shouldBlock: true,
      reason: 'license_not_started',
      label: 'Aguardando início da licença',
      daysDelta: daysUntilStart,
      remainingLabel:
        daysUntilStart === 1 ? 'Inicia em 1 dia' : `Inicia em ${daysUntilStart} dias`,
      startsAtEffective,
      expiresAt,
    };
  }

  if (expiresAt && diffCalendarDays(expiresAt, today) > 0) {
    const daysSinceEnd = diffCalendarDays(expiresAt, today);
    return {
      phase: 'expired',
      shouldBlock: true,
      reason: 'license_validity_expired',
      label: 'Licença expirada',
      daysDelta: -daysSinceEnd,
      remainingLabel:
        daysSinceEnd === 1 ? 'Expirada há 1 dia' : `Expirada há ${daysSinceEnd} dias`,
      startsAtEffective,
      expiresAt,
    };
  }

  const daysRemaining =
    expiresAt != null ? Math.max(0, diffCalendarDays(today, expiresAt)) : null;
  let remainingLabel = 'Sem data final';
  if (daysRemaining != null) {
    if (daysRemaining === 0) remainingLabel = 'Último dia de vigência';
    else if (daysRemaining === 1) remainingLabel = '1 dia restante';
    else remainingLabel = `${daysRemaining} dias restantes`;
  }

  return {
    phase: 'active',
    shouldBlock: false,
    reason: null,
    label: 'Licença vigente',
    daysDelta: daysRemaining,
    remainingLabel,
    startsAtEffective,
    expiresAt,
  };
}

/** Alias — mesma implementação que evaluateCommercialLicense. */
export const evaluateLicenseValidity = evaluateCommercialLicense;

export function resolveCompanyLicenseDisplayStatus(input: {
  tenantStatus?: string | null;
  licenseStatus?: string | null;
  validity: CommercialLicenseEvaluation;
}): CompanyLicenseDisplayStatus {
  const tenant = String(input.tenantStatus || '').toLowerCase();
  const lic = String(input.licenseStatus || '').trim();
  if (tenant === 'blocked' || tenant === 'suspended' || lic === 'Bloqueada') {
    return 'Bloqueada';
  }
  if (input.validity.phase === 'scheduled') return 'Agendada';
  if (input.validity.phase === 'expired' || lic === 'Expirada') return 'Expirada';
  return 'Ativa';
}

/**
 * Estado completo de vigência para API / UI Master.
 * Shape tipado em @pontowebdesk/master-contract — sem recalcular no cliente.
 */
export function buildCommercialLicenseViewState(input: {
  startsAt?: string | null;
  expiresAt?: string | null;
  tenantStatus?: string | null;
  licenseStatus?: string | null;
  now?: Date;
}): CommercialLicenseViewState {
  const now = input.now ?? new Date();
  const validity = evaluateCommercialLicense({
    startsAt: input.startsAt,
    expiresAt: input.expiresAt,
    now,
  });
  const displayStatus = resolveCompanyLicenseDisplayStatus({
    tenantStatus: input.tenantStatus,
    licenseStatus: input.licenseStatus,
    validity,
  });
  const today = toBrazilDateOnly(now)!;
  const daysRemaining =
    validity.phase === 'active' && validity.daysDelta != null
      ? Math.max(0, validity.daysDelta)
      : validity.phase === 'active' && validity.expiresAt == null
        ? null
        : validity.phase === 'active'
          ? 0
          : null;
  const daysExpired =
    validity.phase === 'expired' && validity.daysDelta != null
      ? Math.abs(validity.daysDelta)
      : validity.phase === 'expired'
        ? 0
        : null;

  return {
    phase: validity.phase,
    displayStatus,
    statusLabel: displayStatus,
    shouldBlock: validity.shouldBlock,
    reason: validity.reason,
    label: validity.label,
    remainingLabel: validity.remainingLabel,
    daysDelta: validity.daysDelta,
    daysRemaining,
    daysExpired,
    startsAtEffective: validity.startsAtEffective,
    expiresAt: validity.expiresAt,
    startsToday: validity.startsAtEffective === today && validity.phase !== 'scheduled',
    expiresToday: validity.expiresAt != null && validity.expiresAt === today && validity.phase === 'active',
  };
}
