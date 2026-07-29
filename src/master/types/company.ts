/**
 * Tipos da tela Empresas (Master) — alinhados a ManagedTenant / API /tenants.
 *
 * Fase 6.1 — status de licença:
 *   ACTIVE | TRIAL | SUSPENDED | BLOCKED | CANCELLED
 * Wire API/DB: lowercase; UI pode exibir UPPERCASE.
 */

/** Status comerciais do ciclo de licença (canônico). */
export const COMPANY_LICENSE_STATUSES = [
  'ACTIVE',
  'TRIAL',
  'SUSPENDED',
  'BLOCKED',
  'CANCELLED',
] as const;

export type CompanyLicenseStatus = (typeof COMPANY_LICENSE_STATUSES)[number];

/** Inclui DRAFT (pré-licença / cadastro). */
export const COMPANY_TENANT_STATUSES = ['DRAFT', ...COMPANY_LICENSE_STATUSES] as const;
export type CompanyTenantStatus = (typeof COMPANY_TENANT_STATUSES)[number];

/** Wire persistido pela API (lowercase). */
export type MasterCompanyStatusWire =
  | 'draft'
  | 'active'
  | 'trial'
  | 'suspended'
  | 'blocked'
  | 'cancelled';

export type MasterCompanyMode = 'SAAS' | 'LOCAL' | 'HYBRID' | string;
export type MasterCompanyStatus = MasterCompanyStatusWire | CompanyTenantStatus | string;
export type MasterCompanyPlan = string;
export type MasterInstallationType = 'SAAS_WEB' | 'ON_PREMISE' | string;

export function toCompanyStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').trim();
  if (!s) return '—';
  return s.toUpperCase();
}

/** Rótulos em português para os status comerciais. */
export const COMPANY_STATUS_PT_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  trial: 'Teste',
  suspended: 'Suspenso',
  blocked: 'Bloqueado',
  cancelled: 'Cancelado',
};

export function toCompanyStatusPt(status: string | null | undefined): string {
  const s = String(status || '').trim();
  if (!s) return '—';
  return COMPANY_STATUS_PT_LABELS[s.toLowerCase()] ?? s;
}

/** Rótulos em português para a origem do cadastro. */
export function toCompanySourcePt(source: string | null | undefined): string {
  const s = String(source || '').trim().toLowerCase();
  if (s === 'tenant_manager') return 'Gerenciador de tenants';
  if (s === 'legacy') return 'Legado';
  if (s === 'operational') return 'Operacional';
  return s || '—';
}

/** Linha unificada para listagem / detalhes. */
export type MasterCompanyRow = {
  id: string;
  empresa: string;
  plano: MasterCompanyPlan;
  modo: MasterCompanyMode;
  installationType: MasterInstallationType;
  status: MasterCompanyStatus;
  licenca: string;
  /** Legado — sempre `none` (pagamentos manuais). */
  gateway: string;
  data: string;
  administrador: string;
  administradorEmail: string;
  dominio: string;
  storage: string;
  prompt: string;
  document?: string | null;
  tradeName?: string | null;
  operationalCompanyId?: string | null;
  source: 'tenant_manager' | 'legacy' | 'operational';
  /** Fase 6.6 — descoberta automática. */
  commercialInitialized?: boolean;
  initStatus?: 'initialized' | 'not_initialized' | 'orphan_commercial';
  expiresAt?: string | null;
  /** Vigência comercial — apenas do backend (não recalcular no FE). */
  licenseValidity?: import('../utils/licenseValidity').CommercialLicenseViewState | null;
  commercialSituation?: string | null;
  originLabel?: 'Operacional' | 'Master' | 'Órfão comercial';
  firstAccessStatus?: 'pending' | 'sent' | 'failed' | 'accepted' | null;
  firstAccessSentAt?: string | null;
  firstAccessLastError?: string | null;
};

export type MasterTenantsApiResponse = {
  ok: boolean;
  tenants?: ManagedTenantDto[];
  legacyMasterTenants?: LegacyMasterTenantDto[];
  count?: number;
};

export type { ManagedTenantDto } from '@pontowebdesk/master-contract';

export type LegacyMasterTenantDto = {
  id: string;
  customerId?: string;
  name?: string;
  slug?: string;
  status?: string;
  deploymentMode?: string;
  createdAt?: string;
  updatedAt?: string;
  meta?: Record<string, unknown>;
};
