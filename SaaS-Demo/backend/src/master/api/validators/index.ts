/**
 * Validadores leves da API Master (sem libs externas).
 */

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string; field?: string };

export function validateMasterLoginBody(body: unknown): ValidationResult {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const email = String(raw.email || '').trim().toLowerCase();
  const password = String(raw.password || '');
  if (!email || !email.includes('@')) {
    return { ok: false, message: 'email inválido', field: 'email' };
  }
  if (!password || password.length < 4) {
    return { ok: false, message: 'password é obrigatório', field: 'password' };
  }
  return { ok: true, value: { email, password } };
}

export function validateCreateMasterUserBody(body: unknown): ValidationResult {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const email = String(raw.email || '').trim().toLowerCase();
  const name = String(raw.name || '').trim();
  const password = String(raw.password || '');
  const role = String(raw.role || 'MASTER_SUPPORT').trim().toUpperCase();
  const allowed = new Set([
    'MASTER_OWNER',
    'MASTER_ADMIN',
    'MASTER_SUPPORT',
    'MASTER_FINANCE',
    'MASTER_AUDITOR',
  ]);
  if (!email || !email.includes('@')) {
    return { ok: false, message: 'email inválido', field: 'email' };
  }
  if (!name) return { ok: false, message: 'name é obrigatório', field: 'name' };
  if (password.length < 8) {
    return { ok: false, message: 'password deve ter ao menos 8 caracteres', field: 'password' };
  }
  if (!allowed.has(role)) {
    return { ok: false, message: 'role Master inválida', field: 'role' };
  }
  return { ok: true, value: { email, name, password, role } };
}

const MASTER_USER_ROLES = new Set([
  'MASTER_OWNER',
  'MASTER_ADMIN',
  'MASTER_SUPPORT',
  'MASTER_FINANCE',
  'MASTER_AUDITOR',
]);

export function validateUpdateMasterUserBody(body: unknown): ValidationResult {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const value: Record<string, unknown> = {};
  if (raw.name !== undefined) {
    const name = String(raw.name || '').trim();
    if (!name) return { ok: false, message: 'name é obrigatório', field: 'name' };
    value.name = name;
  }
  if (raw.role !== undefined) {
    const role = String(raw.role || '').trim().toUpperCase();
    if (!MASTER_USER_ROLES.has(role)) {
      return { ok: false, message: 'role Master inválida', field: 'role' };
    }
    value.role = role;
  }
  if (raw.active !== undefined) {
    if (typeof raw.active !== 'boolean') {
      return { ok: false, message: 'active deve ser boolean', field: 'active' };
    }
    value.active = raw.active;
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, message: 'nenhuma alteração informada' };
  }
  return { ok: true, value };
}

export function validateResetMasterUserPasswordBody(body: unknown): ValidationResult {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const newPassword = String(raw.newPassword || raw.password || '');
  if (newPassword.length < 8) {
    return {
      ok: false,
      message: 'newPassword deve ter ao menos 8 caracteres',
      field: 'newPassword',
    };
  }
  return { ok: true, value: { newPassword } };
}

export function validateIdParam(id: unknown, field = 'id'): ValidationResult {
  const value = String(id || '').trim();
  if (!value) return { ok: false, message: `${field} é obrigatório`, field };
  return { ok: true, value: { [field]: value } };
}

import { normalizeCompanyStatusWire } from '../../license/companyLicenseStatus.js';
import {
  isInstallationType,
  modeFromInstallationType,
  parseInstallationType,
  planCycleFromInstallationType,
  requiredPlanCycleForInstallation,
} from '../../commercial/installationType.js';

const PLANS = new Set([
  'FREE',
  'TRIAL',
  'STARTER',
  'PRO',
  'ENTERPRISE',
  'LOCAL',
  'HYBRID',
  'MONTHLY',
  'ANNUAL',
]);
const MODES = new Set(['SAAS', 'LOCAL', 'HYBRID']);
const ACTIONS = new Set(['block', 'unblock', 'suspend', 'cancel', 'activate', 'start_trial']);

export function validateCreateTenantBody(body: unknown): ValidationResult {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const companyRaw =
    raw.company && typeof raw.company === 'object'
      ? (raw.company as Record<string, unknown>)
      : {};
  const adminRaw =
    raw.admin && typeof raw.admin === 'object' ? (raw.admin as Record<string, unknown>) : {};

  const name = String(companyRaw.name || raw.name || '').trim();
  const document = String(companyRaw.document || raw.document || raw.cnpj || '').trim() || null;
  const tradeName = String(companyRaw.tradeName || raw.tradeName || '').trim() || null;
  const adminName = String(adminRaw.name || raw.adminName || '').trim();
  const adminEmail = String(adminRaw.email || raw.adminEmail || '')
    .trim()
    .toLowerCase();
  const domain = String(raw.domain || '').trim().toLowerCase();

  const installationTypeRaw = raw.installationType ?? raw.installation_type ?? raw.tipoInstalacao;
  let installationType = installationTypeRaw != null && String(installationTypeRaw).trim()
    ? parseInstallationType(installationTypeRaw)
    : null;

  const modeRaw = raw.mode != null ? String(raw.mode).trim().toUpperCase() : '';
  if (installationType == null && modeRaw) {
    installationType = modeRaw === 'LOCAL' ? 'ON_PREMISE' : 'SAAS_WEB';
  }
  if (installationType == null) installationType = 'SAAS_WEB';
  if (!isInstallationType(installationType)) {
    return {
      ok: false,
      message: 'tipo de instalação inválido (SAAS_WEB|ON_PREMISE)',
      field: 'installationType',
    };
  }

  const mode = modeRaw && MODES.has(modeRaw)
    ? modeRaw
    : modeFromInstallationType(installationType);

  const planDefault = planCycleFromInstallationType(installationType);
  const plan = String(raw.plan || planDefault).trim().toUpperCase();
  const statusRaw = String(raw.status || 'draft').trim();
  const status = normalizeCompanyStatusWire(statusRaw);

  if (!name) return { ok: false, message: 'nome da empresa é obrigatório', field: 'company.name' };
  if (!adminName) return { ok: false, message: 'admin.name é obrigatório', field: 'admin.name' };
  if (!adminEmail || !adminEmail.includes('@')) {
    return { ok: false, message: 'admin.email inválido', field: 'admin.email' };
  }
  if (!domain) return { ok: false, message: 'domain é obrigatório', field: 'domain' };
  if (!PLANS.has(plan)) return { ok: false, message: 'plano inválido', field: 'plan' };
  if (!MODES.has(mode)) return { ok: false, message: 'modo inválido', field: 'mode' };
  if (!status) {
    return {
      ok: false,
      message: 'status inválido (ACTIVE|TRIAL|SUSPENDED|BLOCKED|CANCELLED|DRAFT)',
      field: 'status',
    };
  }

  if (plan === 'MONTHLY' || plan === 'ANNUAL') {
    const required = requiredPlanCycleForInstallation(installationType);
    if (plan !== required) {
      return {
        ok: false,
        message:
          installationType === 'SAAS_WEB'
            ? 'SAAS_WEB permite somente plano mensal (MONTHLY)'
            : 'ON_PREMISE permite somente plano anual (ANNUAL)',
        field: 'plan',
      };
    }
  }

  return {
    ok: true,
    value: {
      plan,
      mode,
      status,
      gateway: 'none',
      installationType,
      domain,
      company: { name, document, tradeName },
      admin: { name: adminName, email: adminEmail },
    },
  };
}

export function validateUpdateTenantBody(body: unknown): ValidationResult {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const value: Record<string, unknown> = {};

  if (raw.installationType != null || raw.installation_type != null || raw.tipoInstalacao != null) {
    const installationType = parseInstallationType(
      raw.installationType ?? raw.installation_type ?? raw.tipoInstalacao,
    );
    if (!isInstallationType(installationType)) {
      return {
        ok: false,
        message: 'tipo de instalação inválido (SAAS_WEB|ON_PREMISE)',
        field: 'installationType',
      };
    }
    value.installationType = installationType;
    value.mode = modeFromInstallationType(installationType);
    if (raw.plan == null) {
      value.plan = planCycleFromInstallationType(installationType);
    }
  }

  if (raw.plan != null) {
    const plan = String(raw.plan).trim().toUpperCase();
    if (!PLANS.has(plan)) return { ok: false, message: 'plano inválido', field: 'plan' };
    value.plan = plan;
  }
  if (raw.mode != null && value.mode == null) {
    const mode = String(raw.mode).trim().toUpperCase();
    if (!MODES.has(mode)) return { ok: false, message: 'modo inválido', field: 'mode' };
    value.mode = mode;
    if (value.installationType == null) {
      value.installationType = mode === 'LOCAL' ? 'ON_PREMISE' : 'SAAS_WEB';
    }
  }

  // Fase 6.6 — gateway comercial removido; qualquer valor é ignorado/forçado a none.
  if (raw.gateway != null) {
    value.gateway = 'none';
  }

  const installationTypeForCheck =
    (value.installationType as string | undefined) ??
    (raw.installationType != null
      ? parseInstallationType(raw.installationType)
      : undefined);
  const planForCheck = value.plan as string | undefined;
  if (
    installationTypeForCheck &&
    (planForCheck === 'MONTHLY' || planForCheck === 'ANNUAL')
  ) {
    const required = requiredPlanCycleForInstallation(
      parseInstallationType(installationTypeForCheck),
    );
    if (planForCheck !== required) {
      return {
        ok: false,
        message:
          installationTypeForCheck === 'SAAS_WEB'
            ? 'SAAS_WEB permite somente plano mensal (MONTHLY)'
            : 'ON_PREMISE permite somente plano anual (ANNUAL)',
        field: 'plan',
      };
    }
  }

  if (raw.domain != null) {
    const domain = String(raw.domain).trim().toLowerCase();
    if (!domain) return { ok: false, message: 'domain inválido', field: 'domain' };
    value.domain = domain;
  }

  const companyRaw =
    raw.company && typeof raw.company === 'object'
      ? (raw.company as Record<string, unknown>)
      : null;
  if (companyRaw || raw.name != null || raw.document != null || raw.cnpj != null || raw.tradeName != null) {
    const company: Record<string, unknown> = {};
    if (companyRaw?.name != null || raw.name != null) {
      company.name = String(companyRaw?.name ?? raw.name ?? '').trim();
      if (!company.name) return { ok: false, message: 'nome inválido', field: 'company.name' };
    }
    if (companyRaw?.document != null || raw.document != null || raw.cnpj != null) {
      company.document =
        String(companyRaw?.document ?? raw.document ?? raw.cnpj ?? '').trim() || null;
    }
    if (companyRaw?.tradeName != null || raw.tradeName != null) {
      company.tradeName =
        String(companyRaw?.tradeName ?? raw.tradeName ?? '').trim() || null;
    }
    value.company = company;
  }

  const adminRaw =
    raw.admin && typeof raw.admin === 'object' ? (raw.admin as Record<string, unknown>) : null;
  if (adminRaw || raw.adminName != null || raw.adminEmail != null) {
    const admin: Record<string, unknown> = {};
    if (adminRaw?.name != null || raw.adminName != null) {
      admin.name = String(adminRaw?.name ?? raw.adminName ?? '').trim();
    }
    if (adminRaw?.email != null || raw.adminEmail != null) {
      admin.email = String(adminRaw?.email ?? raw.adminEmail ?? '')
        .trim()
        .toLowerCase();
      if (admin.email && !String(admin.email).includes('@')) {
        return { ok: false, message: 'admin.email inválido', field: 'admin.email' };
      }
    }
    value.admin = admin;
  }

  return { ok: true, value };
}

export function validateTenantAction(action: unknown): ValidationResult {
  const value = String(action || '')
    .trim()
    .toLowerCase();
  if (!ACTIONS.has(value)) {
    return {
      ok: false,
      message: 'ação inválida (block|unblock|suspend|cancel|activate|start_trial)',
      field: 'action',
    };
  }
  return { ok: true, value: { action: value } };
}

