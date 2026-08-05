/**
 * Fase 6.1 — Modelo de licença: status de tenants/companies.
 *
 * Status canônicos (contrato do produto):
 *   ACTIVE | TRIAL | SUSPENDED | BLOCKED | CANCELLED
 *
 * Persistência / wire interno (master_tenants.status) permanece em lowercase
 * por compatibilidade com CHECK do Postgres e API existente.
 * `draft` é pré-licença (cadastro) — fora do ciclo comercial, mas aceito.
 */

/** Status comerciais do ciclo de licença da empresa/tenant. */
export const COMPANY_LICENSE_STATUSES = [
  'ACTIVE',
  'TRIAL',
  'SUSPENDED',
  'BLOCKED',
  'CANCELLED',
] as const;

export type CompanyLicenseStatus = (typeof COMPANY_LICENSE_STATUSES)[number];

/** Pré-ativação (rascunho de cadastro) — não faz parte do ciclo comercial. */
export const COMPANY_PRE_LICENSE_STATUS = 'DRAFT' as const;
export type CompanyPreLicenseStatus = typeof COMPANY_PRE_LICENSE_STATUS;

/** Todos os status persistíveis em master_tenants (inclui draft). */
export const COMPANY_TENANT_STATUSES = [
  COMPANY_PRE_LICENSE_STATUS,
  ...COMPANY_LICENSE_STATUSES,
] as const;

export type CompanyTenantStatus = (typeof COMPANY_TENANT_STATUSES)[number];

/** Forma persistida no banco / ManagedTenant.status. */
export type CompanyTenantStatusWire =
  | 'draft'
  | 'active'
  | 'trial'
  | 'suspended'
  | 'blocked'
  | 'cancelled';

const WIRE_BY_CANONICAL: Record<CompanyTenantStatus, CompanyTenantStatusWire> = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  TRIAL: 'trial',
  SUSPENDED: 'suspended',
  BLOCKED: 'blocked',
  CANCELLED: 'cancelled',
};

const CANONICAL_BY_WIRE: Record<CompanyTenantStatusWire, CompanyTenantStatus> = {
  draft: 'DRAFT',
  active: 'ACTIVE',
  trial: 'TRIAL',
  suspended: 'SUSPENDED',
  blocked: 'BLOCKED',
  cancelled: 'CANCELLED',
};

const LICENSE_SET = new Set<string>(COMPANY_LICENSE_STATUSES);
const TENANT_SET = new Set<string>(COMPANY_TENANT_STATUSES);
const WIRE_SET = new Set<string>(Object.keys(CANONICAL_BY_WIRE));

/** Status que bloqueiam operação comercial no SaaS. */
export const COMPANY_BLOCKING_STATUSES: readonly CompanyLicenseStatus[] = [
  'SUSPENDED',
  'BLOCKED',
  'CANCELLED',
] as const;

const BLOCKING_SET = new Set<string>(COMPANY_BLOCKING_STATUSES);

export function isCompanyLicenseStatus(value: unknown): value is CompanyLicenseStatus {
  return typeof value === 'string' && LICENSE_SET.has(value.toUpperCase().trim());
}

export function isCompanyTenantStatus(value: unknown): value is CompanyTenantStatus {
  return typeof value === 'string' && TENANT_SET.has(value.toUpperCase().trim());
}

/**
 * Normaliza qualquer casing para o wire lowercase do banco.
 * Retorna null se inválido.
 */
export function normalizeCompanyStatusWire(
  value: unknown,
): CompanyTenantStatusWire | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (WIRE_SET.has(lower)) return lower as CompanyTenantStatusWire;
  const upper = raw.toUpperCase();
  if (TENANT_SET.has(upper)) return WIRE_BY_CANONICAL[upper as CompanyTenantStatus];
  return null;
}

/** Converte wire → canônico UPPERCASE (ACTIVE, TRIAL, …). */
export function toCompanyStatusCanonical(
  value: unknown,
): CompanyTenantStatus | null {
  const wire = normalizeCompanyStatusWire(value);
  if (!wire) return null;
  return CANONICAL_BY_WIRE[wire];
}

/** Converte canônico UPPERCASE → wire lowercase. */
export function toCompanyStatusWire(
  value: CompanyTenantStatus | CompanyLicenseStatus | CompanyTenantStatusWire | string,
): CompanyTenantStatusWire | null {
  return normalizeCompanyStatusWire(value);
}

/** True se o status bloqueia login/uso comercial no SaaS. */
export function isCompanyStatusBlocking(value: unknown): boolean {
  const canonical = toCompanyStatusCanonical(value);
  return canonical != null && BLOCKING_SET.has(canonical);
}

/** True se o status faz parte do ciclo comercial (exclui DRAFT). */
export function isCompanyLicenseCycleStatus(value: unknown): boolean {
  const canonical = toCompanyStatusCanonical(value);
  return canonical != null && LICENSE_SET.has(canonical);
}

export function companyStatusLabel(value: unknown): string {
  return toCompanyStatusCanonical(value) ?? String(value ?? '—');
}
