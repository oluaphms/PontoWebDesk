/**
 * Contrato canônico de vigência comercial (validity / licenseValidity).
 * Shape keys vêm exclusivamente de @pontowebdesk/master-contract (shared).
 */
import {
  COMMERCIAL_VALIDITY_KEYS,
  type CommercialLicenseViewState,
  type CompanyLicenseDisplayStatus,
  type LicenseValidityPhase,
} from '@pontowebdesk/master-contract';

export { COMMERCIAL_VALIDITY_KEYS };

export type CommercialValidityKey = (typeof COMMERCIAL_VALIDITY_KEYS)[number];

const PHASES = new Set<LicenseValidityPhase>(['scheduled', 'active', 'expired']);
const DISPLAY_STATUSES = new Set<CompanyLicenseDisplayStatus>([
  'Ativa',
  'Agendada',
  'Expirada',
  'Bloqueada',
]);

export type ContractViolation = {
  path: string;
  code: string;
  message: string;
  expected?: string;
  actual?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Valida shape completo de CommercialLicenseViewState (sem recalcular regra). */
export function validateCommercialLicenseViewState(
  value: unknown,
  path: string,
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  if (value == null) {
    violations.push({
      path,
      code: 'MISSING_VALIDITY',
      message: `${path} ausente (null/undefined)`,
      expected: 'CommercialLicenseViewState',
      actual: value,
    });
    return violations;
  }
  if (!isPlainObject(value)) {
    violations.push({
      path,
      code: 'INVALID_VALIDITY_TYPE',
      message: `${path} deve ser objeto`,
      expected: 'object',
      actual: typeof value,
    });
    return violations;
  }

  for (const key of COMMERCIAL_VALIDITY_KEYS) {
    if (!(key in value)) {
      violations.push({
        path: `${path}.${key}`,
        code: 'MISSING_FIELD',
        message: `Campo obrigatório ausente: ${path}.${key}`,
        expected: key,
      });
    }
  }

  const allowed = new Set<string>(COMMERCIAL_VALIDITY_KEYS);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      violations.push({
        path: `${path}.${key}`,
        code: 'EXTRA_FIELD',
        message: `Campo não permitido no contrato: ${path}.${key}`,
        expected: `somente: ${COMMERCIAL_VALIDITY_KEYS.join(',')}`,
        actual: key,
      });
    }
  }

  const phase = value.phase;
  if (phase != null && !PHASES.has(phase as LicenseValidityPhase)) {
    violations.push({
      path: `${path}.phase`,
      code: 'INVALID_ENUM',
      message: `phase inválida`,
      expected: [...PHASES].join('|'),
      actual: phase,
    });
  }

  for (const field of ['displayStatus', 'statusLabel'] as const) {
    const v = value[field];
    if (v != null && !DISPLAY_STATUSES.has(v as CompanyLicenseDisplayStatus)) {
      violations.push({
        path: `${path}.${field}`,
        code: 'INVALID_ENUM',
        message: `${field} inválido`,
        expected: [...DISPLAY_STATUSES].join('|'),
        actual: v,
      });
    }
  }

  if (typeof value.shouldBlock !== 'boolean' && value.shouldBlock !== undefined) {
    violations.push({
      path: `${path}.shouldBlock`,
      code: 'INVALID_TYPE',
      message: 'shouldBlock deve ser boolean',
      actual: typeof value.shouldBlock,
    });
  }

  for (const strField of ['label', 'remainingLabel', 'startsAtEffective'] as const) {
    if (value[strField] != null && typeof value[strField] !== 'string') {
      violations.push({
        path: `${path}.${strField}`,
        code: 'INVALID_TYPE',
        message: `${strField} deve ser string`,
        actual: typeof value[strField],
      });
    }
  }

  if (value.reason != null && typeof value.reason !== 'string') {
    violations.push({
      path: `${path}.reason`,
      code: 'INVALID_TYPE',
      message: 'reason deve ser string|null',
      actual: typeof value.reason,
    });
  }

  if (value.expiresAt != null && typeof value.expiresAt !== 'string') {
    violations.push({
      path: `${path}.expiresAt`,
      code: 'INVALID_TYPE',
      message: 'expiresAt deve ser string|null',
      actual: typeof value.expiresAt,
    });
  }

  for (const numField of ['daysDelta', 'daysRemaining', 'daysExpired'] as const) {
    const n = value[numField];
    if (n != null && typeof n !== 'number') {
      violations.push({
        path: `${path}.${numField}`,
        code: 'INVALID_TYPE',
        message: `${numField} deve ser number|null`,
        actual: typeof n,
      });
    }
  }

  for (const boolField of ['startsToday', 'expiresToday'] as const) {
    if (value[boolField] != null && typeof value[boolField] !== 'boolean') {
      violations.push({
        path: `${path}.${boolField}`,
        code: 'INVALID_TYPE',
        message: `${boolField} deve ser boolean`,
        actual: typeof value[boolField],
      });
    }
  }

  return violations;
}

/** Shape estável para snapshot (ordenado). */
export function commercialValidityShapeSnapshot(): {
  keys: CommercialValidityKey[];
  phases: LicenseValidityPhase[];
  displayStatuses: CompanyLicenseDisplayStatus[];
} {
  return {
    keys: [...COMMERCIAL_VALIDITY_KEYS],
    phases: ['scheduled', 'active', 'expired'],
    displayStatuses: ['Ativa', 'Agendada', 'Expirada', 'Bloqueada'],
  };
}

// silence unused type import when only used in docs
export type { CommercialLicenseViewState };
