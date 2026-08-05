/**
 * API frontend — Central de Licenciamento Master.
 * Somente Master altera; empresa (SaaS) recebe projeção comercial read-only.
 */
import { masterApi } from './masterApi';
import type {
  CompanyLicenseDto,
  LicenseCentralRow,
  LicenseControlRules,
  LicenseHistoryEntry,
  LicenseMode,
  LicenseStatus,
} from '@pontowebdesk/master-contract';

export type {
  CompanyLicenseDto,
  LicenseCentralRow,
  LicenseControlRules,
  LicenseHistoryEntry,
  LicenseMode,
  LicenseStatus,
} from '@pontowebdesk/master-contract';

/** Alias estável da UI — mesmo contrato de CompanyLicenseDto. */
export type CompanyLicense = CompanyLicenseDto;

export type LicenseManagerAction =
  | 'activate'
  | 'block'
  | 'unblock'
  | 'suspend'
  | 'reactivate'
  | 'expire'
  | 'renew'
  | 'delete'
  | 'set_trial'
  | 'set_mode_saas'
  | 'set_mode_local'
  | 'set_mode_hybrid';

export type CreateCompanyLicenseInput = {
  tenantId: string;
  empresa?: string;
  mode?: LicenseMode;
  status?: LicenseStatus;
  plan?: string;
  durationDays?: number;
  startsAt?: string;
  expiresAt?: string | null;
  maxEmployees?: number | null;
  maxDevices?: number | null;
  licenseKey?: string | null;
};

export async function fetchLicenseCentral(): Promise<LicenseCentralRow[]> {
  const res = await masterApi<{
    ok: boolean;
    central?: LicenseCentralRow[];
    items?: LicenseCentralRow[];
    companyLicenses?: CompanyLicense[];
  }>('/licenses');

  function assertCentralRow(row: LicenseCentralRow): LicenseCentralRow {
    if (!row.validity?.displayStatus) {
      throw new Error(
        `Contrato /licenses: validity ausente na linha central ${row.id || row.tenantId || '?'}`,
      );
    }
    return row;
  }

  // Preferir arrays canônicos mesmo vazios (não cair no fallback por length===0).
  if (Array.isArray(res.central)) return res.central.map(assertCentralRow);
  if (Array.isArray(res.items)) return res.items.map(assertCentralRow);
  // Fallback: mapear licenças brutas se enrichment indisponível.
  return (res.companyLicenses ?? []).map((lic) => {
    if (!lic.validity?.displayStatus) {
      throw new Error(
        `Contrato /licenses: validity ausente na licença ${lic.id || lic.tenantId || '?'}`,
      );
    }
    return {
      id: lic.id,
      tenantId: lic.tenantId,
      empresa: lic.empresa,
      plan: lic.plan,
      tipo: lic.mode,
      mode: lic.mode,
      licenseKey: null,
      issuedAt: lic.startsAt,
      startsAt: lic.startsAt,
      expiresAt: lic.expiresAt,
      lastPaymentAt: null,
      lastPaymentStatus: null,
      lastPaymentAmountCents: null,
      status: lic.status,
      isBlocked: lic.status === 'Bloqueada',
      blockedAt: lic.blockedAt,
      blockedReason: lic.blockedReason,
      blockKind: lic.status === 'Bloqueada' ? 'blocked' : null,
      maxEmployees: null,
      maxDevices: null,
      installedVersion: null,
      history: [],
      rules: lic.rules,
      ruleOverrides: lic.ruleOverrides,
      createdAt: lic.createdAt,
      updatedAt: lic.updatedAt,
      validity: lic.validity,
    };
  });
}

/** Compat: listagem antiga. */
export async function fetchCompanyLicenses(): Promise<CompanyLicense[]> {
  const res = await masterApi<{
    ok: boolean;
    companyLicenses?: CompanyLicense[];
    licenses?: CompanyLicense[];
  }>('/licenses');
  return res.companyLicenses ?? res.licenses ?? [];
}

export async function fetchLicenseHistory(id: string): Promise<LicenseHistoryEntry[]> {
  const res = await masterApi<{ ok: boolean; history: LicenseHistoryEntry[] }>(
    `/licenses/${encodeURIComponent(id)}/history`,
  );
  return res.history ?? [];
}

export async function createCompanyLicense(
  input: CreateCompanyLicenseInput,
): Promise<CompanyLicense> {
  const res = await masterApi<{ ok: boolean; license: CompanyLicense }>('/licenses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.license;
}

export async function runLicenseManagerAction(
  id: string,
  action: LicenseManagerAction,
  body?: { durationDays?: number; reason?: string },
): Promise<CompanyLicense> {
  if (action === 'delete') {
    const res = await masterApi<{ ok: boolean; license: CompanyLicense; deleted?: boolean }>(
      `/licenses/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    return res.license;
  }
  const res = await masterApi<{ ok: boolean; license: CompanyLicense }>(
    `/licenses/${encodeURIComponent(id)}/actions/${action}`,
    { method: 'POST', body: JSON.stringify(body || {}) },
  );
  return res.license;
}

export async function setLicenseRules(
  id: string,
  overrides: Partial<Omit<LicenseControlRules, 'daysRemaining'>>,
): Promise<CompanyLicense> {
  const res = await masterApi<{ ok: boolean; license: CompanyLicense }>(
    `/licenses/${encodeURIComponent(id)}/rules`,
    { method: 'POST', body: JSON.stringify(overrides) },
  );
  return res.license;
}

export async function patchCompanyLicense(
  id: string,
  body: {
    plan?: string;
    mode?: LicenseMode;
    startsAt?: string;
    expiresAt?: string | null;
    maxEmployees?: number | null;
    maxDevices?: number | null;
    licenseKey?: string | null;
  },
): Promise<CompanyLicense> {
  const res = await masterApi<{ ok: boolean; license: CompanyLicense }>(
    `/licenses/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return res.license;
}

export function formatLicenseDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(t));
}

export function formatMoneyCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

/** Compat: licenças locais (machine-bound) — mantidas no mesmo GET. */
export type MasterLocalLicenseRow = {
  machineId: string;
  licenseKey: string;
  hardwareHash: string;
  activationDate: string;
  expirationDate: string | null;
  heartbeat: string;
  plan: string | null;
  empresa: string;
  licenca: string;
  validade: string | null;
  offline: boolean;
  ultimoHeartbeat: string;
  prompt: string;
  revoked: boolean;
  remainingDays: number | null;
  validationStatus: string;
};

export type MasterLocalLicenseAction = 'renew' | 'revoke';

export async function fetchMasterLocalLicenses(): Promise<MasterLocalLicenseRow[]> {
  const res = await masterApi<{
    ok: boolean;
    localLicenses: MasterLocalLicenseRow[];
  }>('/licenses');
  return res.localLicenses ?? [];
}

export async function runLocalLicenseAction(
  machineId: string,
  action: MasterLocalLicenseAction,
  body?: Record<string, unknown>,
): Promise<MasterLocalLicenseRow> {
  const res = await masterApi<{
    ok: boolean;
    license: MasterLocalLicenseRow;
  }>(`/licenses/local/${encodeURIComponent(machineId)}/actions/${action}`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.license;
}

export function shortHash(value: string, keep = 10): string {
  const v = String(value || '');
  if (v.length <= keep * 2) return v || '—';
  return `${v.slice(0, keep)}…${v.slice(-6)}`;
}
