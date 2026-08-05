import { masterApi } from './masterApi';
import type {
  LegacyMasterTenantDto,
  ManagedTenantDto,
  MasterCompanyRow,
  MasterTenantsApiResponse,
} from '../types/company';

export type MasterCompanyAction =
  | 'block'
  | 'unblock'
  | 'suspend'
  | 'cancel'
  | 'activate'
  | 'start_trial';

export type CommercialJourneyStep = {
  id: 'customer' | 'company' | 'plan' | 'license' | 'activation' | 'admin' | 'first_login';
  label: string;
  status: 'completed' | 'pending' | 'failed';
  detail: string;
};

export type WizardStepId =
  | 'register_company'
  | 'create_admin'
  | 'choose_plan'
  | 'generate_license'
  | 'send_first_access'
  | 'issue_agent_token'
  | 'finalize';

export type DeploymentWizardStep = {
  id: WizardStepId;
  index: number;
  label: string;
  status: 'completed' | 'current' | 'pending' | 'failed' | 'skipped';
  detail: string;
};

export type DeploymentWizard = {
  tenantId: string;
  mode: string;
  plan: string;
  progressPercent: number;
  currentStepIndex: number;
  currentStepId: WizardStepId | null;
  implantationStatus: 'not_started' | 'in_progress' | 'Implantação concluída' | 'failed';
  canResume: boolean;
  wizardSteps: DeploymentWizardStep[];
  installationId: string | null;
  agentTokenIssuedAt: string | null;
  agentSkipped: boolean;
  implantationCompletedAt: string | null;
  agentTokenOnce?: string | null;
  agentTokenIdOnce?: string | null;
  summary: {
    companyCreated: boolean;
    licenseActive: boolean;
    adminCreated: boolean;
    firstAccessSent: boolean;
    updaterRegistered: boolean;
    implantationCompleted: boolean;
  };
};

export type CommercialJourney = {
  tenantId: string;
  operationalCompanyId: string | null;
  state: 'pending' | 'provisioning' | 'awaiting_first_login' | 'completed' | 'failed';
  customerId: string | null;
  subscriptionId: string | null;
  licenseId: string | null;
  adminUserId: string | null;
  adminEmail: string;
  inviteSentAt: string | null;
  firstAccessStatus?: 'pending' | 'sent' | 'failed' | 'accepted' | null;
  firstAccessLastError?: string | null;
  firstAccessAttempts?: number;
  temporaryPasswordExpiresAt?: string | null;
  firstLoginAt: string | null;
  lastError: string | null;
  nextAction: string | null;
  steps: CommercialJourneyStep[];
  wizard?: DeploymentWizard;
};

export type CreateMasterCompanyInput = {
  company: { name: string; document?: string | null; tradeName?: string | null };
  admin: { name: string; email: string };
  domain: string;
  plan?: string;
  mode?: string;
  status?: string;
  installationType?: string;
};

export type UpdateMasterCompanyInput = {
  company?: { name?: string; document?: string | null; tradeName?: string | null };
  admin?: { name?: string; email?: string };
  domain?: string;
  plan?: string;
  mode?: string;
  installationType?: string;
};

function formatStorage(storage?: ManagedTenantDto['storage']): string {
  if (!storage?.driver) return '—';
  const parts = [storage.driver];
  if (storage.maxGb != null) parts.push(`${storage.maxGb} GB`);
  if (storage.bucket) parts.push(storage.bucket);
  return parts.join(' · ');
}

function formatLicense(license?: ManagedTenantDto['license']): string {
  if (!license) return '—';
  const tier = license.tier?.trim();
  const key = license.licenseKey?.trim();
  if (tier && key) return `${tier} (${key.slice(0, 8)}…)`;
  if (tier) return tier;
  if (key) return key;
  if (license.localLicenseBound) return 'Licença local vinculada';
  return '—';
}

function readPrompt(meta?: Record<string, unknown>): string {
  const raw = meta?.prompt ?? meta?.aiPrompt ?? meta?.systemPrompt;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return '—';
}

export function mapManagedTenant(t: ManagedTenantDto): MasterCompanyRow {
  if (!t.licenseValidity?.displayStatus) {
    throw new Error(`Contrato /tenants: licenseValidity ausente no tenant ${t.id || '?'}`);
  }
  const mode = t.mode || '—';
  const installationType =
    t.installationType ||
    (String(mode).toUpperCase() === 'LOCAL' ? 'ON_PREMISE' : 'SAAS_WEB');
  return {
    id: t.id,
    empresa: t.company?.name?.trim() || 'Sem nome',
    plano: t.plan || '—',
    modo: mode,
    installationType,
    status: t.status || '—',
    licenca: formatLicense(t.license),
    gateway: 'none',
    data: t.createdAt || t.updatedAt || '',
    administrador: t.admin?.name?.trim() || '—',
    administradorEmail: t.admin?.email?.trim() || '',
    dominio: t.domain || '—',
    storage: formatStorage(t.storage),
    prompt: readPrompt(t.meta),
    document: t.company?.document ?? null,
    tradeName: t.company?.tradeName ?? null,
    operationalCompanyId: t.operationalCompanyId ?? null,
    source: 'tenant_manager',
    licenseValidity: t.licenseValidity,
    expiresAt: t.license?.expiresAt ?? null,
  };
}

export function mapLegacyTenant(t: LegacyMasterTenantDto): MasterCompanyRow {
  const meta = t.meta || {};
  const modo = t.deploymentMode || '—';
  return {
    id: t.id,
    empresa: t.name?.trim() || t.slug || 'Sem nome',
    plano: typeof meta.plan === 'string' ? meta.plan : '—',
    modo,
    installationType:
      typeof meta.installationType === 'string'
        ? meta.installationType
        : String(modo).toUpperCase() === 'LOCAL'
          ? 'ON_PREMISE'
          : 'SAAS_WEB',
    status: t.status || '—',
    licenca: typeof meta.license === 'string' ? meta.license : '—',
    gateway: 'none',
    data: t.createdAt || t.updatedAt || '',
    administrador: typeof meta.adminName === 'string' ? meta.adminName : '—',
    administradorEmail: typeof meta.adminEmail === 'string' ? meta.adminEmail : '',
    dominio: typeof meta.domain === 'string' ? meta.domain : t.slug || '—',
    storage: typeof meta.storage === 'string' ? meta.storage : '—',
    prompt: readPrompt(meta),
    document: typeof meta.document === 'string' ? meta.document : null,
    tradeName: null,
    operationalCompanyId: null,
    source: 'legacy',
  };
}

/** Normaliza resposta GET /api/master/tenants (Managed + legacy). */
export function normalizeCompanies(payload: MasterTenantsApiResponse): MasterCompanyRow[] {
  const managed = (payload.tenants ?? []).map(mapManagedTenant);
  const managedIds = new Set(managed.map((r) => r.id));
  const legacy = (payload.legacyMasterTenants ?? [])
    .map(mapLegacyTenant)
    .filter((r) => !managedIds.has(r.id));
  return [...managed, ...legacy].sort((a, b) => {
    const da = Date.parse(a.data) || 0;
    const db = Date.parse(b.data) || 0;
    return db - da;
  });
}

function buildQuery(filter?: {
  q?: string;
  plan?: string;
  mode?: string;
  status?: string;
}): string {
  if (!filter) return '';
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.plan) params.set('plan', filter.plan);
  if (filter.mode) params.set('mode', filter.mode);
  if (filter.status) params.set('status', filter.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function fetchMasterCompanies(filter?: {
  q?: string;
  plan?: string;
  mode?: string;
  status?: string;
}): Promise<MasterCompanyRow[]> {
  const res = await masterApi<MasterTenantsApiResponse>(`/tenants${buildQuery(filter)}`);
  return normalizeCompanies(res);
}

export async function fetchMasterCompany(id: string): Promise<MasterCompanyRow> {
  const res = await masterApi<{ ok: boolean; tenant: ManagedTenantDto }>(
    `/tenants/${encodeURIComponent(id)}`,
  );
  return mapManagedTenant(res.tenant);
}

export async function createMasterCompany(
  input: CreateMasterCompanyInput,
): Promise<ManagedTenantDto> {
  const res = await masterApi<{ ok: boolean; tenant: ManagedTenantDto }>('/tenants', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.tenant;
}

export async function updateMasterCompany(
  id: string,
  input: UpdateMasterCompanyInput,
): Promise<ManagedTenantDto> {
  const res = await masterApi<{ ok: boolean; tenant: ManagedTenantDto }>(
    `/tenants/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return res.tenant;
}

export async function deleteMasterCompany(id: string): Promise<{
  ok: true;
  deleted: true;
  tenantId: string;
  operationalCompanyId: string | null;
  companyName: string;
}> {
  return masterApi(`/tenants/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function runMasterCompanyAction(
  id: string,
  action: MasterCompanyAction,
  reason?: string,
): Promise<ManagedTenantDto> {
  const res = await masterApi<{ ok: boolean; tenant: ManagedTenantDto }>(
    `/tenants/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
    {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
  return res.tenant;
}

export async function fetchCommercialJourney(id: string): Promise<CommercialJourney> {
  const res = await masterApi<{ ok: boolean; journey: CommercialJourney }>(
    `/tenants/${encodeURIComponent(id)}/journey`,
  );
  return res.journey;
}

export async function provisionCommercialJourney(id: string): Promise<CommercialJourney> {
  const res = await masterApi<{ ok: boolean; journey: CommercialJourney }>(
    `/tenants/${encodeURIComponent(id)}/journey/provision`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': `provision:${id}` },
      body: JSON.stringify({}),
    },
  );
  return res.journey;
}

export async function resendCommercialFirstAccess(id: string): Promise<CommercialJourney> {
  const res = await masterApi<{ ok: boolean; journey: CommercialJourney }>(
    `/tenants/${encodeURIComponent(id)}/journey/first-access/resend`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return res.journey;
}

export async function prepareCommercialFirstAccessPassword(id: string): Promise<{
  journey: CommercialJourney;
  temporaryPassword: string;
  expiresAt: string | null;
}> {
  const res = await masterApi<{
    ok: boolean;
    journey: CommercialJourney;
    temporaryPassword: string;
    expiresAt: string | null;
  }>(`/tenants/${encodeURIComponent(id)}/journey/first-access/password`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return {
    journey: res.journey,
    temporaryPassword: res.temporaryPassword,
    expiresAt: res.expiresAt,
  };
}

export async function fetchDeploymentWizard(id: string): Promise<DeploymentWizard> {
  const res = await masterApi<{ ok: boolean; wizard: DeploymentWizard }>(
    `/tenants/${encodeURIComponent(id)}/wizard`,
  );
  return res.wizard;
}

export async function runDeploymentWizardStep(
  id: string,
  step: WizardStepId,
  body?: {
    companyName?: string;
    document?: string;
    adminName?: string;
    adminEmail?: string;
    adminPassword?: string;
    plan?: string;
    mode?: string;
    skipAgent?: boolean;
    channel?: 'stable' | 'beta' | 'rc';
  },
): Promise<{
  journey: CommercialJourney;
  wizard: DeploymentWizard;
  agentToken: string | null;
}> {
  const res = await masterApi<{
    ok: boolean;
    journey: CommercialJourney;
    wizard: DeploymentWizard;
    agentToken?: string | null;
  }>(`/tenants/${encodeURIComponent(id)}/wizard/steps/${encodeURIComponent(step)}`, {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });
  return {
    journey: res.journey,
    wizard: res.wizard,
    agentToken: res.agentToken ?? res.wizard.agentTokenOnce ?? null,
  };
}

export type AutomationTimelineEvent = {
  at: string;
  step: string;
  label: string;
  ok: boolean;
  detail: string;
  automatic: boolean;
};

export type CommercialAutomation = {
  tenantId: string;
  gatewayIntegrated: false;
  note: string;
  state: {
    status: 'idle' | 'running' | 'completed' | 'failed';
    paymentConfirmedAt: string | null;
    paymentRef: { type: string; id: string } | null;
    timeline: AutomationTimelineEvent[];
    lastError: string | null;
    completedAt: string | null;
    startedAt: string | null;
  };
};

export type MasterNotification = {
  id: string;
  at: string;
  tenantId: string | null;
  title: string;
  message: string;
  level: 'info' | 'success' | 'warn' | 'error';
  read: boolean;
};

export async function fetchCommercialAutomation(id: string): Promise<CommercialAutomation> {
  const res = await masterApi<{ ok: boolean; automation: CommercialAutomation }>(
    `/tenants/${encodeURIComponent(id)}/automation`,
  );
  return res.automation;
}

export async function confirmCommercialPayment(
  id: string,
  opts?: { force?: boolean; paymentRefId?: string },
): Promise<CommercialAutomation> {
  const res = await masterApi<{ ok: boolean; automation: CommercialAutomation }>(
    `/tenants/${encodeURIComponent(id)}/automation/confirm-payment`,
    {
      method: 'POST',
      body: JSON.stringify({
        force: opts?.force === true,
        paymentRefType: 'manual',
        paymentRefId: opts?.paymentRefId || `manual:${id}`,
      }),
    },
  );
  return res.automation;
}

export async function retryCommercialAutomation(id: string): Promise<CommercialAutomation> {
  const res = await masterApi<{ ok: boolean; automation: CommercialAutomation }>(
    `/tenants/${encodeURIComponent(id)}/automation/retry`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return res.automation;
}

export async function fetchMasterNotifications(limit = 30): Promise<{
  notifications: MasterNotification[];
  unreadCount: number;
}> {
  const res = await masterApi<{
    ok: boolean;
    notifications: MasterNotification[];
    unreadCount: number;
  }>(`/notifications?limit=${limit}`);
  return {
    notifications: res.notifications || [],
    unreadCount: res.unreadCount || 0,
  };
}

export async function markMasterNotificationsReadAll(): Promise<void> {
  await masterApi('/notifications/read-all', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Fase 6.6 — descoberta automática de companies operacionais. */
export type OperationalCompanyDirectoryRow = {
  operationalCompanyId: string | null;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  masterTenantId: string | null;
  plan: string | null;
  status: string | null;
  expiresAt: string | null;
  /** Vigência comercial — sempre presente em GET /operational-companies. */
  licenseValidity: import('@pontowebdesk/master-contract').CommercialLicenseViewState;
  commercialSituation: string | null;
  firstAccessStatus: 'pending' | 'sent' | 'failed' | 'accepted' | null;
  firstAccessSentAt: string | null;
  firstAccessLastError: string | null;
  origin: 'operational' | 'orphan';
  commercialInitialized: boolean;
  initStatus: 'initialized' | 'not_initialized' | 'orphan_commercial';
};

export type OperationalCompaniesDirectoryResponse = {
  ok: boolean;
  companies: OperationalCompanyDirectoryRow[];
  orphans: Array<{
    masterTenantId: string;
    operationalCompanyId: string;
    companyName: string;
    status: string;
    reason: string;
  }>;
  count: number;
  uninitializedCount: number;
};

export type InitializeCommercialResponse = {
  ok: true;
  reused: boolean;
  operationalCompanyId: string;
  masterTenantId: string;
  subscriptionId: string | null;
  licenseId: string | null;
  crmInitialized: boolean;
  financeEntryId: string | null;
  notificationsInitialized: boolean;
  message: string;
};

export function mapOperationalDirectoryRow(
  row: OperationalCompanyDirectoryRow,
): MasterCompanyRow {
  if (!row.licenseValidity?.displayStatus) {
    throw new Error(
      `Contrato /operational-companies: licenseValidity ausente em ${row.masterTenantId || row.operationalCompanyId || '?'}`,
    );
  }
  const id = row.masterTenantId || row.operationalCompanyId || 'unknown';
  return {
    id,
    empresa: row.razaoSocial,
    plano: row.plan || '—',
    modo: 'SAAS',
    installationType: 'SAAS_WEB',
    status: row.status || (row.commercialInitialized ? '—' : 'draft'),
    licenca: '—',
    gateway: 'none',
    data: '',
    administrador: '—',
    administradorEmail: row.email || '',
    dominio: '—',
    storage: '—',
    prompt: '—',
    document: row.cnpj,
    tradeName: row.nomeFantasia,
    operationalCompanyId: row.operationalCompanyId,
    source: 'operational',
    commercialInitialized: row.commercialInitialized,
    initStatus: row.initStatus,
    expiresAt: row.expiresAt,
    licenseValidity: row.licenseValidity,
    commercialSituation: row.commercialSituation,
    firstAccessStatus: row.firstAccessStatus,
    firstAccessSentAt: row.firstAccessSentAt,
    firstAccessLastError: row.firstAccessLastError,
    originLabel:
      row.origin === 'orphan'
        ? 'Órfão comercial'
        : 'Operacional',
  };
}

export async function fetchOperationalCompaniesDirectory(filter?: {
  q?: string;
}): Promise<OperationalCompaniesDirectoryResponse> {
  const params = new URLSearchParams();
  if (filter?.q) params.set('q', filter.q);
  const qs = params.toString();
  return masterApi<OperationalCompaniesDirectoryResponse>(
    `/operational-companies${qs ? `?${qs}` : ''}`,
  );
}

export async function initializeOperationalCommercial(
  companyId: string,
): Promise<InitializeCommercialResponse> {
  return masterApi<InitializeCommercialResponse>(
    `/operational-companies/${encodeURIComponent(companyId)}/initialize-commercial`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export function formatCompanyDate(iso: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(t));
}
