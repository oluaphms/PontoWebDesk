import { randomUUID } from 'node:crypto';
import { pool } from '../../db/index.js';
import { tableHasColumn } from '../../db/schemaColumns.js';
import { setUserPasswordForTenant } from '../../services/adminSetPasswordService.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import { projectCommercialStateToSaas } from '../commercial/index.js';
import { MasterDomainTransaction } from '../tx/MasterDomainTransaction.js';
import type { ManagedTenant } from '../tenantManager/tenantManager.types.js';
import type { CompanyLicense } from '../licenseManager/types.js';
import type { SubscriptionEntity } from '../subscriptions/subscription.entity.js';
import type { LicensePlan } from '../subscriptions/subscription.types.js';
import { buildJourneyLicenseExpiryInput } from '../subscriptions/subscriptionLicensePeriod.js';
import {
  buildInviteToken,
  hashInviteToken,
  isInviteDeliveryErrorCode,
  sendFirstAccessInvite,
} from './firstAccessInvite.service.js';
import {
  composeWizardSteps,
  mergeWizardMetaRaw,
  parseWizardMeta,
  validateWizardStep,
  type WizardEvidence,
  type WizardMeta,
  type WizardStepId,
  type WizardStepView,
  WIZARD_STEP_IDS,
} from './deploymentWizard.js';
import { UpdateControlPlaneService } from '../updates/UpdateControlPlaneService.js';
import { issueAgentToken } from '../../updateAgent/agentToken.js';
import {
  decideTemporaryPasswordAction,
  decryptTemporaryPassword,
  encryptTemporaryPassword,
  sha256Password,
  type TemporaryPasswordRegenerateReason,
} from './temporaryFirstAccessPassword.js';

/** Mapeia ciclo comercial MONTHLY/ANNUAL para LicensePlan legado da jornada. */
function toLegacyLicensePlan(plan: ManagedTenant['plan']): LicensePlan {
  if (
    plan === 'FREE' ||
    plan === 'TRIAL' ||
    plan === 'STARTER' ||
    plan === 'PRO' ||
    plan === 'ENTERPRISE' ||
    plan === 'LOCAL' ||
    plan === 'HYBRID'
  ) {
    return plan;
  }
  return 'PRO';
}
type Actor = { userId?: string | null; email?: string | null };
type OnboardingState =
  | 'pending'
  | 'provisioning'
  | 'awaiting_first_login'
  | 'completed'
  | 'failed';

type OnboardingRow = {
  id: string;
  idempotency_key: string;
  master_tenant_id: string;
  operational_company_id: string;
  customer_id: string;
  subscription_id: string | null;
  license_id: string | null;
  admin_email: string;
  admin_user_id: string | null;
  state: OnboardingState;
  completed_steps: unknown;
  invite_sent_at: Date | string | null;
  first_login_at: Date | string | null;
  first_access_status?: string | null;
  first_access_last_error?: string | null;
  first_access_attempts?: number | string | null;
  first_access_sent_at?: Date | string | null;
  temporary_password_hash?: string | null;
  temporary_password_expires_at?: Date | string | null;
  last_error: string | null;
  wizard_meta?: unknown;
  implantation_completed_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type JourneyStepId =
  | 'customer'
  | 'company'
  | 'plan'
  | 'license'
  | 'activation'
  | 'admin'
  | 'first_login';

export type JourneyStep = {
  id: JourneyStepId;
  label: string;
  status: 'completed' | 'pending' | 'failed';
  detail: string;
};

export type CommercialJourneySnapshot = {
  tenantId: string;
  operationalCompanyId: string | null;
  state: OnboardingState;
  completedSteps: string[];
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
  steps: JourneyStep[];
  nextAction: string | null;
  /** FASE 28 — Assistente de Implantação */
  wizard: DeploymentWizardSnapshot;
};

export type DeploymentWizardSnapshot = {
  tenantId: string;
  mode: string;
  plan: string;
  progressPercent: number;
  currentStepIndex: number;
  currentStepId: WizardStepId | null;
  implantationStatus: 'not_started' | 'in_progress' | 'Implantação concluída' | 'failed';
  canResume: boolean;
  wizardSteps: WizardStepView[];
  installationId: string | null;
  agentTokenIssuedAt: string | null;
  agentSkipped: boolean;
  implantationCompletedAt: string | null;
  /** Token em texto puro — somente logo após a etapa issue_agent_token. */
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

export class CommercialJourneyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommercialJourneyError';
  }
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value : new Date(value);
  return Number.isNaN(time.getTime()) ? String(value) : time.toISOString();
}

function stepsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

async function findOnboarding(tenantId: string): Promise<OnboardingRow | null> {
  const result = await pool.queryMaster<OnboardingRow>(
    `select * from public.master_commercial_onboardings
      where master_tenant_id = $1 limit 1`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

async function ensureOnboarding(
  tenant: ManagedTenant,
  idempotencyKey: string,
): Promise<OnboardingRow> {
  const existing = await findOnboarding(tenant.id);
  if (existing) return existing;
  // Reutiliza company operacional já vinculada (descoberta); só gera UUID se ainda não houver.
  const operationalCompanyId =
    String(tenant.operationalCompanyId || '').trim() || randomUUID();
  const result = await pool.queryMaster<OnboardingRow>(
    `insert into public.master_commercial_onboardings (
       id, idempotency_key, master_tenant_id, operational_company_id,
       customer_id, admin_email, state
     ) values ($1,$2,$3,$4,$5,$6,'pending')
     on conflict (master_tenant_id) do update set updated_at = now()
     returning *`,
    [
      `onb_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      idempotencyKey,
      tenant.id,
      operationalCompanyId,
      `cust_${tenant.id}`,
      tenant.admin.email,
    ],
  );
  return result.rows[0];
}

async function updateOnboarding(
  tenantId: string,
  input: {
    state?: OnboardingState;
    step?: JourneyStepId;
    subscriptionId?: string;
    licenseId?: string;
    adminUserId?: string;
    inviteSent?: boolean;
    firstAccessStatus?: 'pending' | 'sent' | 'failed' | 'accepted';
    firstAccessError?: string | null;
    firstAccessAttemptsIncrement?: boolean;
    firstAccessSentAt?: boolean;
    temporaryPasswordHash?: string | null;
    temporaryPasswordExpiresAt?: string | null;
    inviteTokenHash?: string | null;
    inviteTokenExpiresAt?: string | null;
    error?: string | null;
    wizardMeta?: WizardMeta;
    implantationCompleted?: boolean;
  },
): Promise<OnboardingRow> {
  const current = await findOnboarding(tenantId);
  if (!current) throw new CommercialJourneyError(404, 'JOURNEY_NOT_FOUND', 'Jornada não encontrada.');
  const completed = stepsFrom(current.completed_steps);
  if (input.step && !completed.includes(input.step)) completed.push(input.step);
  const nextMeta =
    input.wizardMeta != null
      ? mergeWizardMetaRaw(current.wizard_meta, input.wizardMeta)
      : null;
  const result = await pool.queryMaster<OnboardingRow>(
    `update public.master_commercial_onboardings
        set state = coalesce($2, state),
            completed_steps = $3::jsonb,
            subscription_id = coalesce($4, subscription_id),
            license_id = coalesce($5, license_id),
            admin_user_id = coalesce($6, admin_user_id),
            invite_sent_at = case when $7 then now() else invite_sent_at end,
            first_access_status = coalesce($8, first_access_status),
            -- Só altera status_convite/erro quando o caller envia firstAccessError (undefined = preservar).
            first_access_last_error = case
              when $9::boolean then $10
              else first_access_last_error
            end,
            first_access_attempts = case when $11 then coalesce(first_access_attempts, 0) + 1 else first_access_attempts end,
            first_access_sent_at = case when $12 then now() else first_access_sent_at end,
            temporary_password_hash = coalesce($13, temporary_password_hash),
            temporary_password_expires_at = coalesce($14::timestamptz, temporary_password_expires_at),
            invite_token_hash = coalesce($15, invite_token_hash),
            invite_token_expires_at = coalesce($16::timestamptz, invite_token_expires_at),
            last_error = $17,
            wizard_meta = coalesce($18::jsonb, wizard_meta),
            implantation_completed_at = case
              when $19 then coalesce(implantation_completed_at, now())
              else implantation_completed_at
            end,
            updated_at = now()
      where master_tenant_id = $1
      returning *`,
    [
      tenantId,
      input.state ?? null,
      JSON.stringify(completed),
      input.subscriptionId ?? null,
      input.licenseId ?? null,
      input.adminUserId ?? null,
      input.inviteSent ?? false,
      input.firstAccessStatus ?? null,
      input.firstAccessError !== undefined,
      input.firstAccessError !== undefined ? (input.firstAccessError ?? null) : null,
      input.firstAccessAttemptsIncrement ?? false,
      input.firstAccessSentAt ?? false,
      input.temporaryPasswordHash ?? null,
      input.temporaryPasswordExpiresAt ?? null,
      input.inviteTokenHash ?? null,
      input.inviteTokenExpiresAt ?? null,
      input.error ?? null,
      nextMeta != null ? JSON.stringify(nextMeta) : null,
      input.implantationCompleted ?? false,
    ],
  );
  return result.rows[0];
}

function buildWizardEvidence(
  tenant: ManagedTenant,
  onboarding: OnboardingRow | null,
  license: CompanyLicense | null,
  subscription: SubscriptionEntity | null,
): WizardEvidence {
  const meta = parseWizardMeta(onboarding?.wizard_meta);
  const licenseActive =
    Boolean(license) &&
    (license!.status === 'Ativa' || license!.status === 'Trial');
  const mode = String(tenant.mode || 'SAAS').toUpperCase();
  const agentRegistered = Boolean(meta.installationId && meta.agentTokenIssuedAt);
  return {
    hasTenant: Boolean(tenant.id),
    hasCompanyName: Boolean(tenant.company?.name?.trim()),
    hasOperationalCompany: Boolean(
      onboarding?.operational_company_id || tenant.operationalCompanyId,
    ),
    hasAdminName: Boolean(tenant.admin?.name?.trim()),
    hasAdminEmail: Boolean(tenant.admin?.email?.trim()),
    hasAdminUser: Boolean(onboarding?.admin_user_id),
    hasPlan: Boolean(tenant.plan),
    hasSubscription: Boolean(subscription || onboarding?.subscription_id),
    hasLicense: Boolean(license || onboarding?.license_id),
    licenseActive,
    inviteSent: Boolean(onboarding?.invite_sent_at),
    agentRegistered,
    agentSkipped: meta.agentSkipped === true,
    implantationCompleted: Boolean(onboarding?.implantation_completed_at),
    failed: onboarding?.state === 'failed',
    mode,
  };
}

function buildWizardSnapshot(
  tenant: ManagedTenant,
  onboarding: OnboardingRow | null,
  license: CompanyLicense | null,
  subscription: SubscriptionEntity | null,
  once?: { agentToken?: string | null; agentTokenId?: string | null },
): DeploymentWizardSnapshot {
  const evidence = buildWizardEvidence(tenant, onboarding, license, subscription);
  const composed = composeWizardSteps(evidence);
  const meta = parseWizardMeta(onboarding?.wizard_meta);
  const current =
    composed.currentStepIndex >= 0 && composed.currentStepIndex < WIZARD_STEP_IDS.length
      ? WIZARD_STEP_IDS[composed.currentStepIndex]
      : null;
  return {
    tenantId: tenant.id,
    mode: evidence.mode,
    plan: String(tenant.plan || ''),
    progressPercent: composed.progressPercent,
    currentStepIndex: composed.currentStepIndex,
    currentStepId: current,
    implantationStatus: composed.implantationStatus,
    canResume: composed.canResume,
    wizardSteps: composed.steps,
    installationId: meta.installationId ?? null,
    agentTokenIssuedAt: meta.agentTokenIssuedAt ?? null,
    agentSkipped: evidence.agentSkipped,
    implantationCompletedAt: onboarding?.implantation_completed_at
      ? iso(onboarding.implantation_completed_at)
      : null,
    agentTokenOnce: once?.agentToken ?? null,
    agentTokenIdOnce: once?.agentTokenId ?? null,
    summary: {
      companyCreated: evidence.hasOperationalCompany && evidence.hasCompanyName,
      licenseActive: evidence.licenseActive,
      adminCreated: evidence.hasAdminUser,
      firstAccessSent: evidence.inviteSent,
      updaterRegistered: evidence.agentRegistered || evidence.agentSkipped,
      implantationCompleted: evidence.implantationCompleted,
    },
  };
}

async function ensureOperationalCompany(
  tenant: ManagedTenant,
  operationalCompanyId: string,
): Promise<void> {
  // Delega ao writer canônico (mesmo caminho de provision/repair; retry work_shifts no wrapper).
  const { insertOperationalCompanyFromTenant } = await import(
    '../provisioning/MasterCompanyProvisioningService.js'
  );
  await insertOperationalCompanyFromTenant(tenant, operationalCompanyId);
}

async function findLocalUser(email: string): Promise<{ id: string; companyId: string } | null> {
  const result = await pool.queryMaster<{ id: string; company_id: string }>(
    `select id::text as id, company_id::text as company_id
       from public.users
      where lower(trim(email)) = $1
      limit 1`,
    [email],
  );
  return result.rows[0]
    ? { id: result.rows[0].id, companyId: result.rows[0].company_id }
    : null;
}

/**
 * Auth operacional LOCAL_API (PostgreSQL + bcrypt em public.users).
 * Produção/Supabase permanece no caminho ensureSupabaseAuthUser quando configurado.
 *
 * Precedência:
 * 1) OPERATIONAL_AUTH_PROVIDER / DATA_PROVIDER / VITE_DATA_PROVIDER = LOCAL_API → local
 * 2) = SUPABASE → Supabase Admin
 * 3) Sem marcador: local se faltar SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY
 */
function usesLocalOperationalAuth(): boolean {
  const explicit = String(
    process.env.OPERATIONAL_AUTH_PROVIDER ||
      process.env.DATA_PROVIDER ||
      process.env.VITE_DATA_PROVIDER ||
      '',
  )
    .trim()
    .toUpperCase();
  if (
    explicit === 'LOCAL_API' ||
    explicit === 'LOCAL' ||
    explicit === 'NATIVE' ||
    explicit === 'POSTGRES'
  ) {
    return true;
  }
  if (explicit === 'SUPABASE') return false;
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return !url || !serviceKey;
}

function supabaseAdminConfig(): { url: string; serviceKey: string } {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    throw new CommercialJourneyError(
      503,
      'FIRST_ACCESS_PROVIDER_NOT_CONFIGURED',
      'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para enviar o primeiro acesso.',
    );
  }
  return { url, serviceKey };
}

async function findSupabaseAuthUser(email: string): Promise<string | null> {
  const { url, serviceKey } = supabaseAdminConfig();
  const response = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    users?: Array<{ id?: string; email?: string | null }>;
  };
  return (
    body.users?.find((user) => user.email?.trim().toLowerCase() === email)?.id ?? null
  );
}

async function ensureLocalOperationalAdmin(
  tenant: ManagedTenant,
  operationalCompanyId: string,
): Promise<string> {
  const email = tenant.admin.email.trim().toLowerCase();
  const nome = tenant.admin.name.trim() || email;
  const local = await findLocalUser(email);
  if (local && local.companyId !== operationalCompanyId) {
    throw new CommercialJourneyError(
      409,
      'ADMIN_EMAIL_ALREADY_LINKED',
      'O e-mail do administrador já pertence a outra empresa.',
    );
  }

  const userId = local?.id || randomUUID();
  const hasStatus = await tableHasColumn('users', 'status');
  const hasCargo = await tableHasColumn('users', 'cargo');

  const columns = ['id', 'email', 'nome', 'role', 'company_id'];
  const values: unknown[] = [userId, email, nome, 'admin', operationalCompanyId];
  if (hasCargo) {
    columns.push('cargo');
    values.push('Administrador');
  }
  if (hasStatus) {
    columns.push('status');
    values.push('active');
  }

  const placeholders = values.map((_, index) => `$${index + 1}`).join(',');
  const updates = [
    'email = excluded.email',
    'nome = excluded.nome',
    `role = 'admin'`,
    'company_id = excluded.company_id',
  ];
  if (hasCargo) updates.push(`cargo = coalesce(excluded.cargo, public.users.cargo)`);
  if (hasStatus) updates.push(`status = 'active'`);

  await pool.queryMaster(
    `insert into public.users (${columns.join(',')})
     values (${placeholders})
     on conflict (id) do update set
       ${updates.join(',\n       ')}`,
    values,
  );

  // Garante password_hash bcrypt válido (login operacional LOCAL_API) sem Supabase Auth.
  const passwordResult = await setUserPasswordForTenant({
    companyId: operationalCompanyId,
    email,
    newPassword: '',
    markMustChangePassword: true,
  });
  if (!passwordResult.ok) {
    throw new CommercialJourneyError(
      passwordResult.status,
      'LOCAL_ADMIN_PASSWORD_FAILED',
      passwordResult.error,
    );
  }

  return userId;
}

async function ensureSupabaseAuthUser(email: string, name: string): Promise<string> {
  const existing = await findSupabaseAuthUser(email);
  if (existing) return existing;
  const { url, serviceKey } = supabaseAdminConfig();
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { name, provisioned_by: 'master_control_plane' },
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; msg?: string };
    throw new CommercialJourneyError(
      response.status,
      'AUTH_USER_PROVISION_FAILED',
      body.message || body.msg || 'Falha ao criar usuário de autenticação.',
    );
  }
  const body = (await response.json()) as { id?: string; user?: { id?: string } };
  const userId = body.id ?? body.user?.id;
  if (!userId) {
    throw new CommercialJourneyError(
      502,
      'AUTH_USER_INVALID_RESPONSE',
      'Provedor de autenticação não retornou o usuário.',
    );
  }
  return userId;
}

async function ensureOperationalAdmin(
  tenant: ManagedTenant,
  operationalCompanyId: string,
): Promise<string> {
  if (usesLocalOperationalAuth()) {
    return ensureLocalOperationalAdmin(tenant, operationalCompanyId);
  }

  const email = tenant.admin.email.trim().toLowerCase();
  const local = await findLocalUser(email);
  if (local && local.companyId !== operationalCompanyId) {
    throw new CommercialJourneyError(
      409,
      'ADMIN_EMAIL_ALREADY_LINKED',
      'O e-mail do administrador já pertence a outra empresa.',
    );
  }
  const authUserId = await ensureSupabaseAuthUser(email, tenant.admin.name);
  if (local && local.id !== authUserId) {
    throw new CommercialJourneyError(
      409,
      'ADMIN_IDENTITY_CONFLICT',
      'O e-mail possui identidades divergentes entre autenticação e aplicação.',
    );
  }

  const hasStatus = await tableHasColumn('users', 'status');
  const columns = ['id', 'email', 'nome', 'role', 'company_id'];
  const values: unknown[] = [authUserId, email, tenant.admin.name, 'admin', operationalCompanyId];
  if (hasStatus) {
    columns.push('status');
    values.push('active');
  }
  const placeholders = values.map((_, index) => `$${index + 1}`).join(',');
  await pool.queryMaster(
    `insert into public.users (${columns.join(',')})
     values (${placeholders})
     on conflict (id) do update set
       email = excluded.email,
       nome = excluded.nome,
       role = 'admin',
       company_id = excluded.company_id`,
    values,
  );
  return authUserId;
}

function snapshot(
  tenant: ManagedTenant,
  onboarding: OnboardingRow | null,
  license: CompanyLicense | null,
  subscription: SubscriptionEntity | null,
): CommercialJourneySnapshot {
  const completed = onboarding ? stepsFrom(onboarding.completed_steps) : [];
  const failed = onboarding?.state === 'failed';
  const step = (id: JourneyStepId, label: string, done: boolean, detail: string): JourneyStep => ({
    id,
    label,
    status: done ? 'completed' : failed && id === completed.at(-1) ? 'failed' : 'pending',
    detail,
  });
  const steps: JourneyStep[] = [
    step('customer', 'Cliente', true, `cust_${tenant.id}`),
    step(
      'company',
      'Empresa',
      Boolean(onboarding?.operational_company_id),
      onboarding?.operational_company_id ?? 'Empresa operacional pendente',
    ),
    step('plan', 'Plano', Boolean(subscription), subscription?.plan ?? tenant.plan),
    step('license', 'Licença', Boolean(license), license?.status ?? 'Licença pendente'),
    step(
      'activation',
      'Ativação',
      tenant.status === 'active' && Boolean(license),
      tenant.status === 'active' ? 'Empresa ativa' : 'Ativação pendente',
    ),
    step(
      'admin',
      'Administrador',
      Boolean(onboarding?.admin_user_id),
      onboarding?.invite_sent_at
        ? 'Primeiro acesso enviado'
        : onboarding?.admin_user_id
          ? 'Administrador provisionado'
          : tenant.admin.email,
    ),
    step(
      'first_login',
      'Primeiro login',
      Boolean(onboarding?.first_login_at),
      onboarding?.first_login_at ? `Concluído em ${iso(onboarding.first_login_at)}` : 'Aguardando',
    ),
  ];
  const next = steps.find((item) => item.status !== 'completed');
  const firstLoginAt = onboarding ? iso(onboarding.first_login_at) : null;
  let firstAccessStatus: 'pending' | 'sent' | 'failed' | 'accepted' | null =
    onboarding?.first_access_status
      ? (String(onboarding.first_access_status) as
          | 'pending'
          | 'sent'
          | 'failed'
          | 'accepted')
      : null;
  let firstAccessLastError = onboarding?.first_access_last_error ?? null;
  // Usuário já ativo / primeiro login: convite cumpriu a finalidade.
  if (firstLoginAt || firstAccessStatus === 'accepted') {
    firstAccessStatus = 'accepted';
    firstAccessLastError = null;
  }
  return {
    tenantId: tenant.id,
    operationalCompanyId: onboarding?.operational_company_id ?? tenant.operationalCompanyId ?? null,
    state: onboarding?.state ?? 'pending',
    completedSteps: completed,
    customerId: onboarding?.customer_id ?? null,
    subscriptionId: onboarding?.subscription_id ?? subscription?.id ?? null,
    licenseId: onboarding?.license_id ?? license?.id ?? null,
    adminUserId: onboarding?.admin_user_id ?? null,
    adminEmail: tenant.admin.email,
    inviteSentAt: onboarding ? iso(onboarding.invite_sent_at) : null,
    firstAccessStatus,
    firstAccessLastError,
    firstAccessAttempts: Number(onboarding?.first_access_attempts ?? 0) || 0,
    temporaryPasswordExpiresAt: onboarding ? iso(onboarding.temporary_password_expires_at ?? null) : null,
    firstLoginAt,
    lastError: onboarding?.last_error ?? null,
    steps,
    nextAction: next?.label ?? null,
    wizard: buildWizardSnapshot(tenant, onboarding, license, subscription),
  };
}

async function resources(tenantId: string) {
  const tenant = await MasterPlatformService.getTenantsService().get(tenantId);
  const [onboardingRaw, license, subscription] = await Promise.all([
    findOnboarding(tenantId),
    MasterPlatformService.getLicenseManager().getByTenantId(tenantId),
    MasterPlatformService.getLifecycle().findCurrentByTenant(tenantId),
  ]);
  const onboarding = await healOnboardingInviteIfAdminActive(onboardingRaw);
  return { tenant, onboarding, license, subscription };
}

/**
 * Se o admin operacional já está ativo com senha definitiva, o convite não pode
 * permanecer como "não enviado" / failed na UI após o uso da conta.
 */
async function healOnboardingInviteIfAdminActive(
  onboarding: OnboardingRow | null,
): Promise<OnboardingRow | null> {
  if (!onboarding?.admin_user_id) return onboarding;
  if (onboarding.first_login_at) return onboarding;
  if (String(onboarding.first_access_status || '') === 'accepted') return onboarding;

  try {
    const result = await pool.queryTrustedBootstrap<{
      must_change_password: boolean | null;
      status: string | null;
    }>(
      `select coalesce(must_change_password, false) as must_change_password,
              coalesce(status, 'active')::text as status
         from public.users
        where id::text = $1
        limit 1`,
      [onboarding.admin_user_id],
    );
    const user = result.rows[0];
    if (!user || String(user.status).toLowerCase() !== 'active') return onboarding;
    if (user.must_change_password === true) return onboarding;

    return await updateOnboarding(onboarding.master_tenant_id, {
      firstAccessStatus: 'accepted',
      firstAccessError: null,
      state: 'completed',
    });
  } catch {
    return onboarding;
  }
}

function hashPasswordPlaintext(value: string): string {
  return sha256Password(value);
}

/**
 * Gera nova senha provisória e grava password_hash + metadados de onboarding.
 * Sempre regenera — use resolveTemporaryFirstAccessPassword para reutilização idempotente.
 */
async function issueTemporaryFirstAccessPassword(
  tenant: ManagedTenant,
  onboarding: OnboardingRow,
): Promise<{ temporaryPassword: string; expiresAt: string | null }> {
  const companyId = onboarding.operational_company_id || String(tenant.operationalCompanyId || '');
  if (!companyId) {
    throw new CommercialJourneyError(400, 'COMPANY_FIRST', 'Empresa operacional necessária para o convite inicial.');
  }
  const result = await setUserPasswordForTenant({
    companyId,
    email: tenant.admin.email,
    newPassword: '',
    markMustChangePassword: true,
  });
  if (!result.ok || !result.temporaryPassword) {
    throw new CommercialJourneyError(
      result.ok ? 500 : result.status,
      'TEMP_PASSWORD_GENERATION_FAILED',
      result.ok ? 'Senha provisória não retornada.' : result.error,
    );
  }
  const inviteToken = buildInviteToken();
  await updateOnboarding(tenant.id, {
    firstAccessStatus: 'pending',
    firstAccessError: null,
    temporaryPasswordHash: hashPasswordPlaintext(result.temporaryPassword),
    temporaryPasswordExpiresAt: result.expiresAt ?? null,
    inviteTokenHash: hashInviteToken(inviteToken),
    inviteTokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    wizardMeta: {
      inviteTemporaryPasswordEnc: encryptTemporaryPassword(result.temporaryPassword),
    },
  });
  await import('../operationalCompany/OperationalCompanyWriter.js')
    .then(({ markOperationalCompanyFirstAccessPending }) =>
      markOperationalCompanyFirstAccessPending(companyId, tenant.admin.email),
    )
    .catch(() => undefined);
  return {
    temporaryPassword: result.temporaryPassword,
    expiresAt: result.expiresAt ?? null,
  };
}

/**
 * Resolve senha provisória para o convite: reutiliza se ainda válida; senão regenera.
 * forceNew=true → sempre regenera (botão "Gerar nova senha").
 */
async function resolveTemporaryFirstAccessPassword(
  tenant: ManagedTenant,
  onboarding: OnboardingRow,
  options: { forceNew?: boolean } = {},
): Promise<{
  temporaryPassword: string;
  expiresAt: string | null;
  passwordAction: 'reused' | 'regenerated';
  regenerateReason: TemporaryPasswordRegenerateReason | null;
}> {
  const meta = parseWizardMeta(onboarding.wizard_meta);
  const mustChangePassword = await readAdminMustChangePassword(onboarding, tenant);
  const decision = decideTemporaryPasswordAction({
    forceNew: Boolean(options.forceNew),
    firstLoginAt: onboarding.first_login_at,
    expiresAt: onboarding.temporary_password_expires_at,
    temporaryPasswordHash: onboarding.temporary_password_hash,
    encryptedPassword: meta.inviteTemporaryPasswordEnc,
    mustChangePassword,
  });

  if (decision.action === 'reuse' && meta.inviteTemporaryPasswordEnc) {
    const plain = decryptTemporaryPassword(meta.inviteTemporaryPasswordEnc);
    const expectedHash = String(onboarding.temporary_password_hash || '');
    if (plain && expectedHash && sha256Password(plain) === expectedHash) {
      return {
        temporaryPassword: plain,
        expiresAt: iso(onboarding.temporary_password_expires_at ?? null),
        passwordAction: 'reused',
        regenerateReason: null,
      };
    }
  }

  const regenerateReason: TemporaryPasswordRegenerateReason =
    decision.action === 'regenerate' ? decision.reason : 'hash_mismatch';

  const issued = await issueTemporaryFirstAccessPassword(tenant, onboarding);
  return {
    temporaryPassword: issued.temporaryPassword,
    expiresAt: issued.expiresAt,
    passwordAction: 'regenerated',
    regenerateReason,
  };
}

/** Leitura apenas — não altera autenticação. false = provisória já não vale. */
async function readAdminMustChangePassword(
  onboarding: OnboardingRow,
  tenant: ManagedTenant,
): Promise<boolean | null> {
  const hasCol = await tableHasColumn('users', 'must_change_password');
  if (!hasCol) return null;
  const companyId = onboarding.operational_company_id || String(tenant.operationalCompanyId || '');
  const email = String(tenant.admin.email || onboarding.admin_email || '')
    .trim()
    .toLowerCase();
  if (!companyId || !email) return null;
  const result = await pool
    .queryMaster<{ must_change_password: boolean | null }>(
      `select must_change_password
         from public.users
        where company_id::text = $1
          and lower(email) = $2
        limit 1`,
      [companyId, email],
    )
    .catch(() => ({ rows: [] as Array<{ must_change_password: boolean | null }> }));
  const row = result.rows[0];
  if (!row) return null;
  if (row.must_change_password === true) return true;
  if (row.must_change_password === false) return false;
  return null;
}

/** Envia (ou reenvia) o e-mail de convite — não regenera senha se a provisória ainda for válida. */
async function sendFirstAccessInviteForTenant(
  tenantId: string,
  actor: Actor,
): Promise<CommercialJourneySnapshot> {
  const data = await resources(tenantId);
  if (!data.onboarding?.admin_user_id) {
    throw new CommercialJourneyError(
      409,
      'ADMIN_NOT_PROVISIONED',
      'Provisione o administrador antes de enviar o convite inicial.',
    );
  }
  const prepared = await resolveTemporaryFirstAccessPassword(data.tenant, data.onboarding, {
    forceNew: false,
  });
  const sent = await sendFirstAccessInvite({
    companyName: data.tenant.company.name,
    adminName: data.tenant.admin.name,
    adminEmail: data.tenant.admin.email,
    temporaryPassword: prepared.temporaryPassword,
  });
  if (!sent.ok) {
    const recoverState =
      data.onboarding.state === 'failed' || data.onboarding.state === 'provisioning'
        ? data.onboarding.first_login_at
          ? 'completed'
          : 'awaiting_first_login'
        : undefined;
    await updateOnboarding(tenantId, {
      firstAccessStatus: 'failed',
      firstAccessError: sent.error,
      firstAccessAttemptsIncrement: true,
      // Convite é independente: não marcar jornada/provisionamento como failed.
      ...(recoverState ? { state: recoverState } : {}),
      error: null,
    });
    MasterPlatformService.getAudit().append({
      actorUserId: actor.userId ?? null,
      actorEmail: actor.email ?? null,
      action: 'CONVITE_EMPRESA_FALHOU',
      resource: 'commercial_journey',
      companyId: data.onboarding.operational_company_id ?? null,
      companyName: data.tenant.company.name,
      message: 'Falha ao enviar convite inicial da empresa',
      meta: {
        tenantId,
        destinationEmail: data.tenant.admin.email,
        provider: sent.provider,
        code: sent.code,
        error: sent.error,
        technicalError: sent.technicalError ?? sent.error,
        responseCode: sent.responseCode ?? null,
        responseBody: sent.responseBody ?? null,
        passwordAction: prepared.passwordAction,
        regenerateReason: prepared.regenerateReason,
      },
    });
    throw new CommercialJourneyError(502, sent.code, sent.error);
  }

  const onboarding = await updateOnboarding(tenantId, {
    inviteSent: true,
    firstAccessStatus: 'sent',
    firstAccessError: null,
    firstAccessAttemptsIncrement: true,
    firstAccessSentAt: true,
    error: null,
    state: data.onboarding.first_login_at ? 'completed' : 'awaiting_first_login',
  });
  const operationalCompanyId = data.onboarding?.operational_company_id;
  if (operationalCompanyId) {
    await import('../operationalCompany/OperationalCompanyWriter.js')
      .then(({ markOperationalCompanyFirstAccessSent }) =>
        markOperationalCompanyFirstAccessSent(
          String(operationalCompanyId),
          data.tenant.admin.email,
        ),
      )
      .catch(() => undefined);
  }

  if (prepared.passwordAction === 'regenerated') {
    MasterPlatformService.getAudit().append({
      actorUserId: actor.userId ?? null,
      actorEmail: actor.email ?? null,
      action: 'SENHA_PROVISORIA_REGENERADA',
      resource: 'commercial_journey',
      companyId: data.onboarding.operational_company_id ?? null,
      companyName: data.tenant.company.name,
      message: 'Senha regenerada',
      meta: {
        tenantId,
        regenerateReason: prepared.regenerateReason,
        expiresAt: prepared.expiresAt,
      },
    });
  } else {
    MasterPlatformService.getAudit().append({
      actorUserId: actor.userId ?? null,
      actorEmail: actor.email ?? null,
      action: 'SENHA_PROVISORIA_REUTILIZADA',
      resource: 'commercial_journey',
      companyId: data.onboarding.operational_company_id ?? null,
      companyName: data.tenant.company.name,
      message: 'Senha reutilizada',
      meta: {
        tenantId,
        expiresAt: prepared.expiresAt,
      },
    });
  }

  MasterPlatformService.getAudit().append({
    actorUserId: actor.userId ?? null,
    actorEmail: actor.email ?? null,
    action: 'CONVITE_EMPRESA_ENVIADO',
    resource: 'commercial_journey',
    companyId: data.onboarding.operational_company_id ?? null,
    companyName: data.tenant.company.name,
    message: 'Convite enviado',
    meta: {
      tenantId,
      destinationEmail: data.tenant.admin.email,
      provider: sent.provider,
      messageId: sent.messageId,
      expiresAt: prepared.expiresAt,
      passwordAction: prepared.passwordAction,
      regenerateReason: prepared.regenerateReason,
    },
  });

  return snapshot(data.tenant, onboarding, data.license, data.subscription);
}

export const CommercialJourneyService = {
  async prepareFirstAccessPassword(
    tenantId: string,
    actor: Actor = {},
  ): Promise<CommercialJourneySnapshot & { temporaryPassword: string; expiresAt: string | null }> {
    const data = await resources(tenantId);
    if (!data.onboarding?.admin_user_id) {
      throw new CommercialJourneyError(
        409,
        'ADMIN_NOT_PROVISIONED',
        'Provisione o administrador antes de gerar senha provisória.',
      );
    }
    const issued = await resolveTemporaryFirstAccessPassword(data.tenant, data.onboarding, {
      forceNew: true,
    });
    MasterPlatformService.getAudit().append({
      actorUserId: actor.userId ?? null,
      actorEmail: actor.email ?? null,
      action: 'SENHA_PROVISORIA_REGENERADA',
      resource: 'commercial_journey',
      companyId: data.onboarding.operational_company_id ?? null,
      companyName: data.tenant.company.name,
      message: 'Senha regenerada',
      meta: {
        tenantId,
        regenerateReason: issued.regenerateReason ?? 'force_new',
        expiresAt: issued.expiresAt,
      },
    });
    const updated = await resources(tenantId);
    return {
      ...snapshot(updated.tenant, updated.onboarding, updated.license, updated.subscription),
      temporaryPassword: issued.temporaryPassword,
      expiresAt: issued.expiresAt,
    };
  },

  async get(tenantId: string): Promise<CommercialJourneySnapshot> {
    const data = await resources(tenantId);
    return snapshot(data.tenant, data.onboarding, data.license, data.subscription);
  },

  async provision(
    tenantId: string,
    idempotencyKey: string,
    _actor: Actor,
    options: { sendFirstAccess?: boolean } = {},
  ): Promise<CommercialJourneySnapshot> {
    return MasterDomainTransaction.run(async () => {
    let tenant = await MasterPlatformService.getTenantsService().get(tenantId);
    let onboarding = await ensureOnboarding(
      tenant,
      idempotencyKey.trim() || `provision:${tenantId}`,
    );
    await updateOnboarding(tenantId, { state: 'provisioning', error: null });

    try {
      MasterDomainTransaction.step('journey_ensure_company');
      await ensureOperationalCompany(tenant, onboarding.operational_company_id);
      tenant = await MasterPlatformService.getTenantsService().update(tenantId, {
        operationalCompanyId: onboarding.operational_company_id,
      });
      onboarding = await updateOnboarding(tenantId, { step: 'company' });

      const lifecycle = MasterPlatformService.getLifecycle();
      let subscription = await lifecycle.findCurrentByTenant(tenantId);
      if (!subscription) {
        MasterDomainTransaction.step('journey_create_subscription');
        subscription = await lifecycle.createSubscription({
          tenantId,
          customerId: onboarding.customer_id,
          plan: toLegacyLicensePlan(tenant.plan),
          meta: { source: 'commercial_journey' },
        });
      }
      onboarding = await updateOnboarding(tenantId, {
        step: 'plan',
        subscriptionId: subscription.id,
      });

      const licenseManager = MasterPlatformService.getLicenseManager();
      let license = await licenseManager.getByTenantId(tenantId);
      if (!license) {
        const { isLicenseIntentionallyDeleted } = await import(
          '../license/licenseDeletionGuard.js'
        );
        if (await isLicenseIntentionallyDeleted(tenantId)) {
          throw new CommercialJourneyError(
            409,
            'LICENSE_INTENTIONALLY_DELETED',
            'Licença foi excluída no Master. Use o wizard (gerar licença) para recriar explicitamente.',
          );
        }
        MasterDomainTransaction.step('journey_create_license');
        const plan = toLegacyLicensePlan(tenant.plan);
        const expiry = buildJourneyLicenseExpiryInput({
          plan,
          subscriptionExpiresAt: subscription.expiresAt,
        });
        license = await licenseManager.create({
          tenantId,
          empresa: tenant.company.name,
          mode: tenant.mode,
          status: tenant.plan === 'TRIAL' || tenant.plan === 'FREE' ? 'Trial' : 'Ativa',
          plan,
          ...expiry,
        });
      }
      onboarding = await updateOnboarding(tenantId, {
        step: 'license',
        licenseId: license.id,
      });

      if (tenant.status !== 'active') {
        tenant = await MasterPlatformService.getTenantsService().applyAction(
          tenantId,
          'activate',
          { reason: 'commercial_journey' },
        );
      }
      if (license.status === 'Bloqueada' || license.status === 'Expirada') {
        license = await licenseManager.action(license.id, 'activate');
      }
      onboarding = await updateOnboarding(tenantId, { step: 'activation' });
      await projectCommercialStateToSaas({
        tenant,
        license,
        subscription: subscription.toProps(),
      });

      const adminUserId = await ensureOperationalAdmin(
        tenant,
        onboarding.operational_company_id,
      );
      onboarding = await updateOnboarding(tenantId, {
        step: 'admin',
        adminUserId,
      });
      if (options.sendFirstAccess !== false && !onboarding.invite_sent_at) {
        const snap = await sendFirstAccessInviteForTenant(tenantId, _actor);
        onboarding = await findOnboarding(tenantId) ?? onboarding;
        return snap;
      } else if (onboarding.invite_sent_at) {
        onboarding = await updateOnboarding(tenantId, {
          state: onboarding.first_login_at ? 'completed' : 'awaiting_first_login',
        });
      } else {
        onboarding = await updateOnboarding(tenantId, {
          state: 'completed',
        });
      }

      return snapshot(tenant, onboarding, license, subscription);
    } catch (error) {
      // Falha só de convite: status_convite já gravado; não invalidar provisionamento.
      if (
        error instanceof CommercialJourneyError &&
        isInviteDeliveryErrorCode(error.code)
      ) {
        throw error;
      }
      await updateOnboarding(tenantId, {
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      throw error;
    }
    });
  },

  async resendFirstAccess(
    tenantId: string,
    actor: Actor = {},
  ): Promise<CommercialJourneySnapshot> {
    return sendFirstAccessInviteForTenant(tenantId, actor);
  },

  /** Snapshot do Assistente de Implantação (FASE 28). */
  async getWizard(tenantId: string): Promise<DeploymentWizardSnapshot> {
    const data = await resources(tenantId);
    return buildWizardSnapshot(data.tenant, data.onboarding, data.license, data.subscription);
  },

  /**
   * Executa uma etapa do wizard (idempotente / retomável).
   * body opcional para atualizar plano/admin/empresa antes da etapa.
   */
  async runWizardStep(
    tenantId: string,
    step: WizardStepId,
    input: {
      companyName?: string;
      document?: string;
      adminName?: string;
      adminEmail?: string;
      adminPassword?: string;
      plan?: string;
      mode?: string;
      skipAgent?: boolean;
      channel?: 'stable' | 'beta' | 'rc';
    } = {},
    actor: Actor = {},
  ): Promise<CommercialJourneySnapshot> {
    if (!(WIZARD_STEP_IDS as readonly string[]).includes(step)) {
      throw new CommercialJourneyError(400, 'INVALID_WIZARD_STEP', 'Etapa do wizard inválida.');
    }

    let tenant = await MasterPlatformService.getTenantsService().get(tenantId);
    let onboarding = await ensureOnboarding(tenant, `wizard:${tenantId}`);
    await updateOnboarding(tenantId, { state: 'provisioning', error: null });

    // Aplica patches de formulário antes da etapa.
    const patch: {
      company?: { name?: string; document?: string | null };
      admin?: { name?: string; email?: string };
      plan?: ManagedTenant['plan'];
      mode?: ManagedTenant['mode'];
    } = {};
    if (input.companyName?.trim()) {
      patch.company = {
        ...(patch.company || {}),
        name: input.companyName.trim(),
        document: input.document?.trim() || tenant.company.document || null,
      };
    }
    if (input.adminName?.trim() || input.adminEmail?.trim()) {
      patch.admin = {
        name: input.adminName?.trim() || tenant.admin.name,
        email: input.adminEmail?.trim() || tenant.admin.email,
      };
    }
    if (input.plan?.trim()) {
      patch.plan = input.plan.trim().toUpperCase() as ManagedTenant['plan'];
    }
    if (input.mode?.trim()) {
      patch.mode = input.mode.trim().toUpperCase() as ManagedTenant['mode'];
    }
    if (Object.keys(patch).length > 0) {
      tenant = await MasterPlatformService.getTenantsService().update(tenantId, patch);
    }

    let license = await MasterPlatformService.getLicenseManager().getByTenantId(tenantId);
    let subscription = await MasterPlatformService.getLifecycle().findCurrentByTenant(tenantId);
    let onceToken: string | null = null;
    let onceTokenId: string | null = null;

    const evidence = buildWizardEvidence(tenant, onboarding, license, subscription);
    const validation = validateWizardStep(step, evidence);
    if (!validation.ok) {
      throw new CommercialJourneyError(400, validation.code, validation.message);
    }

    try {
      switch (step) {
        case 'register_company': {
          await ensureOperationalCompany(tenant, onboarding.operational_company_id);
          tenant = await MasterPlatformService.getTenantsService().update(tenantId, {
            operationalCompanyId: onboarding.operational_company_id,
          });
          onboarding = await updateOnboarding(tenantId, {
            step: 'company',
            wizardMeta: { lastWizardStep: step },
          });
          break;
        }
        case 'create_admin': {
          if (!onboarding.operational_company_id && !tenant.operationalCompanyId) {
            throw new CommercialJourneyError(400, 'COMPANY_FIRST', 'Cadastre a empresa antes.');
          }
          const companyId =
            onboarding.operational_company_id || String(tenant.operationalCompanyId);
          const adminUserId = await ensureOperationalAdmin(tenant, companyId);
          const provisionalPassword = input.adminPassword?.trim();
          if (provisionalPassword) {
            const applied = await setUserPasswordForTenant({
              companyId,
              email: tenant.admin.email,
              newPassword: provisionalPassword,
            });
            if (!applied.ok) {
              throw new CommercialJourneyError(
                applied.status,
                'ADMIN_PASSWORD_REJECTED',
                applied.error,
              );
            }
            // Senha provisória definida → primeiro acesso já provisionado (sem e-mail de convite).
            onboarding = await updateOnboarding(tenantId, {
              step: 'admin',
              adminUserId,
              inviteSent: true,
              wizardMeta: { lastWizardStep: step },
            });
          } else {
            onboarding = await updateOnboarding(tenantId, {
              step: 'admin',
              adminUserId,
              wizardMeta: { lastWizardStep: step },
            });
          }
          break;
        }
        case 'choose_plan': {
          const lifecycle = MasterPlatformService.getLifecycle();
          subscription = await lifecycle.findCurrentByTenant(tenantId);
          if (!subscription) {
            subscription = await lifecycle.createSubscription({
              tenantId,
              customerId: onboarding.customer_id,
              plan: toLegacyLicensePlan(tenant.plan),
              meta: { source: 'deployment_wizard' },
            });
          }
          onboarding = await updateOnboarding(tenantId, {
            step: 'plan',
            subscriptionId: subscription.id,
            wizardMeta: { lastWizardStep: step },
          });
          break;
        }
        case 'generate_license': {
          const licenseManager = MasterPlatformService.getLicenseManager();
          license = await licenseManager.getByTenantId(tenantId);
          if (!license) {
            const { clearLicenseIntentionallyDeleted } = await import(
              '../license/licenseDeletionGuard.js'
            );
            // Ação explícita do wizard: limpa tombstone e recria.
            await clearLicenseIntentionallyDeleted(tenantId);
            subscription =
              subscription ??
              (await MasterPlatformService.getLifecycle().findCurrentByTenant(tenantId));
            const plan = toLegacyLicensePlan(tenant.plan);
            const expiry = buildJourneyLicenseExpiryInput({
              plan,
              subscriptionExpiresAt: subscription?.expiresAt ?? null,
            });
            license = await licenseManager.create({
              tenantId,
              empresa: tenant.company.name,
              mode: tenant.mode,
              status: tenant.plan === 'TRIAL' || tenant.plan === 'FREE' ? 'Trial' : 'Ativa',
              plan,
              ...expiry,
            });
          }
          if (license.status === 'Bloqueada' || license.status === 'Expirada') {
            license = await licenseManager.action(license.id, 'activate');
          }
          if (tenant.status !== 'active') {
            tenant = await MasterPlatformService.getTenantsService().applyAction(
              tenantId,
              'activate',
              { reason: 'deployment_wizard' },
            );
          }
          subscription =
            subscription ??
            (await MasterPlatformService.getLifecycle().findCurrentByTenant(tenantId));
          await projectCommercialStateToSaas({
            tenant,
            license,
            subscription: subscription?.toProps() ?? null,
          });
          onboarding = await updateOnboarding(tenantId, {
            step: 'license',
            licenseId: license.id,
            wizardMeta: { lastWizardStep: step },
          });
          await updateOnboarding(tenantId, { step: 'activation' });
          break;
        }
        case 'send_first_access': {
          if (!onboarding.admin_user_id) {
            const companyId =
              onboarding.operational_company_id || String(tenant.operationalCompanyId || '');
            if (!companyId) {
              throw new CommercialJourneyError(400, 'ADMIN_FIRST', 'Crie o administrador antes.');
            }
            const adminUserId = await ensureOperationalAdmin(tenant, companyId);
            onboarding = await updateOnboarding(tenantId, { adminUserId, step: 'admin' });
          }
          const sentSnapshot = await sendFirstAccessInviteForTenant(tenantId, actor);
          onboarding = (await findOnboarding(tenantId)) ?? onboarding;
          await updateOnboarding(tenantId, {
            wizardMeta: { lastWizardStep: step },
          });
          if (!sentSnapshot.inviteSentAt) {
            throw new CommercialJourneyError(502, 'FIRST_ACCESS_SEND_FAILED', 'Convite não foi registrado.');
          }
          break;
        }
        case 'issue_agent_token': {
          const mode = String(tenant.mode || 'SAAS').toUpperCase();
          const skip = input.skipAgent === true || mode === 'SAAS';
          if (skip) {
            onboarding = await updateOnboarding(tenantId, {
              wizardMeta: {
                lastWizardStep: step,
                agentSkipped: true,
              },
            });
            break;
          }
          const companyId =
            tenant.operationalCompanyId || onboarding.operational_company_id;
          if (!companyId) {
            throw new CommercialJourneyError(
              400,
              'COMPANY_FIRST',
              'Empresa operacional necessária para o Update Agent.',
            );
          }
          const meta = parseWizardMeta(onboarding.wizard_meta);
          let installationId = meta.installationId ?? null;
          if (!installationId) {
            const installation = await UpdateControlPlaneService.upsertInstallation({
              companyId,
              companyName: tenant.company.name,
              mode: mode === 'HYBRID' ? 'HYBRID' : 'LOCAL',
              component: 'platform',
              channel: input.channel ?? 'stable',
              source: 'manual',
            });
            installationId = installation.id;
          }
          const issued = await issueAgentToken(installationId, actor.userId ?? null);
          onceToken = issued.token;
          onceTokenId = issued.tokenId;
          onboarding = await updateOnboarding(tenantId, {
            wizardMeta: {
              lastWizardStep: step,
              installationId,
              agentTokenId: issued.tokenId,
              agentTokenIssuedAt: new Date().toISOString(),
              agentSkipped: false,
            },
          });
          break;
        }
        case 'finalize': {
          const finalEvidence = buildWizardEvidence(
            tenant,
            onboarding,
            license,
            subscription,
          );
          const check = validateWizardStep('finalize', finalEvidence);
          if (!check.ok) {
            throw new CommercialJourneyError(400, check.code, check.message);
          }
          onboarding = await updateOnboarding(tenantId, {
            implantationCompleted: true,
            state: onboarding.first_login_at ? 'completed' : 'awaiting_first_login',
            wizardMeta: { lastWizardStep: step },
            error: null,
          });
          break;
        }
        default:
          throw new CommercialJourneyError(400, 'INVALID_WIZARD_STEP', 'Etapa inválida.');
      }

      license = await MasterPlatformService.getLicenseManager().getByTenantId(tenantId);
      subscription = await MasterPlatformService.getLifecycle().findCurrentByTenant(tenantId);
      tenant = await MasterPlatformService.getTenantsService().get(tenantId);
      onboarding = (await findOnboarding(tenantId)) ?? onboarding;

      const base = snapshot(tenant, onboarding, license, subscription);
      if (onceToken) {
        return {
          ...base,
          wizard: {
            ...base.wizard,
            agentTokenOnce: onceToken,
            agentTokenIdOnce: onceTokenId,
          },
        };
      }
      return base;
    } catch (error) {
      // Falha só de convite: status_convite já gravado; não invalidar provisionamento.
      if (
        error instanceof CommercialJourneyError &&
        isInviteDeliveryErrorCode(error.code)
      ) {
        throw error;
      }
      await updateOnboarding(tenantId, {
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      throw error;
    }
  },

  /** Persiste campos extras em wizard_meta (ex.: automação comercial). */
  async patchWizardMeta(
    tenantId: string,
    patch: WizardMeta & { automation?: Record<string, unknown> },
  ): Promise<void> {
    const onboarding = await findOnboarding(tenantId);
    if (!onboarding) {
      throw new CommercialJourneyError(404, 'JOURNEY_NOT_FOUND', 'Jornada não encontrada.');
    }
    await updateOnboarding(tenantId, { wizardMeta: patch });
  },

  /** Lê estado da automação comercial persistido em wizard_meta.automation. */
  async readAutomationState(tenantId: string): Promise<Record<string, unknown> | null> {
    const onboarding = await findOnboarding(tenantId);
    if (!onboarding) return null;
    const meta = parseWizardMeta(onboarding.wizard_meta);
    return meta.automation ?? null;
  },
};

