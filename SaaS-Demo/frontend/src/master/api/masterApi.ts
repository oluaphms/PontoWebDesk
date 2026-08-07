/**
 * Cliente HTTP do Painel Master — consome /api/master/* (InMemory no backend).
 * Não usa authToken / sessão das empresas.
 */
import { PlatformService } from '../../platform/PlatformService';

const MASTER_TOKEN_KEY = 'pwd_master_token';
const MASTER_SESSION_KEY = 'pwd_master_session';

export type MasterSession = {
  userId: string;
  email: string;
  name: string;
  role: string;
  permissions?: string[];
  token: string;
  expiresAt: string;
};

export function getMasterToken(): string {
  try {
    return String(localStorage.getItem(MASTER_TOKEN_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function getMasterSession(): MasterSession | null {
  try {
    const raw = localStorage.getItem(MASTER_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MasterSession;
  } catch {
    return null;
  }
}

export function setMasterSession(session: MasterSession): void {
  localStorage.setItem(MASTER_TOKEN_KEY, session.token);
  localStorage.setItem(MASTER_SESSION_KEY, JSON.stringify(session));
}

export function clearMasterSession(): void {
  localStorage.removeItem(MASTER_TOKEN_KEY);
  localStorage.removeItem(MASTER_SESSION_KEY);
}

/** Controle de UX; a autorização definitiva continua no backend. */
export function hasMasterPermission(permission: string): boolean {
  const permissions = getMasterSession()?.permissions;
  // Fail-closed: sessão sem matriz não libera UI privilegiada.
  if (!Array.isArray(permissions)) return false;
  return permissions.includes(permission);
}

/** Encerra sessão Master no servidor (revoga + limpa cookies) e no localStorage. */
export async function masterLogout(): Promise<void> {
  try {
    await masterApi('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch {
    // Limpa local mesmo se a API falhar (token já expirado / rede).
  } finally {
    clearMasterSession();
  }
}

function apiRoot(): string {
  const base = PlatformService.getApiBaseUrl().replace(/\/+$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
}

type MasterApiErrorBody = {
  ok?: boolean;
  message?: string;
  error?: string;
  code?: string;
};

let refreshInFlight: Promise<boolean> | null = null;

async function tryMasterRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const url = `${apiRoot()}/master/auth/refresh`;
      const headers = new Headers({ 'Content-Type': 'application/json' });
      const token = getMasterToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const res = await fetch(url, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        session?: MasterSession;
      };
      if (!res.ok || !data.session?.token) return false;
      const prev = getMasterSession();
      setMasterSession({
        userId: data.session.userId || prev?.userId || '',
        email: data.session.email || prev?.email || '',
        name: data.session.name || prev?.name || '',
        role: data.session.role || prev?.role || '',
        permissions: data.session.permissions ?? prev?.permissions ?? [],
        token: data.session.token,
        expiresAt: data.session.expiresAt || prev?.expiresAt || '',
      });
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function isAuthFailure(status: number, body: MasterApiErrorBody): boolean {
  if (status !== 401) return false;
  const code = String(body.code || body.error || '').toUpperCase();
  return (
    code.includes('MASTER_TOKEN') ||
    code.includes('MASTER_AUTH') ||
    code.includes('UNAUTHORIZED') ||
    /revogad|inválid|expirad|login master/i.test(String(body.message || ''))
  );
}

export async function masterApi<T = unknown>(
  path: string,
  init: RequestInit = {},
  _retried = false,
): Promise<T> {
  const url = `${apiRoot()}/master${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getMasterToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers, credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as T & MasterApiErrorBody;
  if (!res.ok) {
    const skipRefresh =
      _retried ||
      path.includes('/auth/login') ||
      path.includes('/auth/refresh') ||
      path.includes('/auth/logout') ||
      path.includes('/auth/forgot-password') ||
      path.includes('/auth/reset-password');

    if (!skipRefresh && isAuthFailure(res.status, data)) {
      const refreshed = await tryMasterRefresh();
      if (refreshed) {
        return masterApi<T>(path, init, true);
      }
      clearMasterSession();
    }

    throw new Error(data.message || data.error || `master_api_${res.status}`);
  }
  return data;
}

export async function masterLogin(email: string, password: string): Promise<MasterSession> {
  const data = await masterApi<{
    ok: boolean;
    session: MasterSession;
  }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setMasterSession(data.session);
  return data.session;
}

export async function masterForgotPassword(email: string): Promise<{
  challengeId: string;
  debugCode?: string;
  message: string;
}> {
  const data = await masterApi<{
    ok: boolean;
    challengeId: string;
    debugCode?: string;
    message?: string;
  }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  return {
    challengeId: data.challengeId,
    debugCode: data.debugCode,
    message:
      data.message ||
      'Se existir uma conta Master com este e-mail, use o código de verificação para definir uma nova senha.',
  };
}

export async function masterResetPassword(input: {
  challengeId: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  await masterApi('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({
      challengeId: input.challengeId,
      code: input.code,
      newPassword: input.newPassword,
    }),
  });
}

export type MasterRole =
  | 'MASTER_OWNER'
  | 'MASTER_ADMIN'
  | 'MASTER_SUPPORT'
  | 'MASTER_FINANCE'
  | 'MASTER_AUDITOR';

export type MasterUser = {
  id: string;
  email: string;
  name: string;
  role: MasterRole;
  active: boolean;
  /** Fundador do SaaS — atributo imutável. */
  isFounder?: boolean;
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
};

export async function listMasterUsers(): Promise<{
  users: MasterUser[];
  permissionModel: 'role_based';
  mfaSupported: boolean;
}> {
  const data = await masterApi<{
    users: MasterUser[];
    permissionModel?: 'role_based';
    mfaSupported?: boolean;
  }>('/users');
  return {
    users: data.users ?? [],
    permissionModel: data.permissionModel ?? 'role_based',
    mfaSupported: data.mfaSupported === true,
  };
}

export async function createMasterUser(input: {
  email: string;
  name: string;
  password: string;
  role: MasterRole;
}): Promise<MasterUser> {
  const data = await masterApi<{ user: MasterUser }>('/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.user;
}

export async function updateMasterUser(
  id: string,
  input: { name?: string; role?: MasterRole; active?: boolean },
): Promise<MasterUser> {
  const data = await masterApi<{ user: MasterUser }>(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return data.user;
}

export async function resetMasterUserPassword(
  id: string,
  newPassword: string,
): Promise<void> {
  await masterApi(`/users/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
}

export type {
  MasterExecutiveSummary,
  MasterRecentPayment,
} from '@pontowebdesk/master-contract';

export type MasterDashboardResponse = {
  ok: boolean;
  modules: Array<{ id: string; label: string; description: string }>;
  summary: {
    counts: Record<string, number>;
  };
  executive: import('@pontowebdesk/master-contract').MasterExecutiveSummary;
};

export type MasterSummaryResponse = {
  ok: boolean;
  summary: { counts: Record<string, number> };
  executive: import('@pontowebdesk/master-contract').MasterExecutiveSummary;
  modules: string[];
  persistence: 'in_memory';
};

export type MasterLogsResponse = {
  ok: boolean;
  logs: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
  counts: {
    logs: number;
    audit: number;
    returnedLogs: number;
    returnedAudit: number;
  };
  persistence: 'in_memory';
};

export type MasterHealthResponse = {
  ok: boolean;
  tokenType: 'master';
  separateFromOperationalHealth: true;
  health: {
    ok: boolean;
    platformReady: boolean;
    licensed: boolean;
    mode: string | null;
    environment: string | null;
    chargingEnabled: boolean;
    gatewayActive: string | null;
    billingProvider: string;
    billingExternalReady: boolean;
    syncPending: number;
    offlinePending: number;
    unresolvedConflicts: number;
    checkedAt: string;
  };
  monitoring: Record<string, unknown>;
  persistence: 'in_memory';
};

export function fetchMasterDashboard(): Promise<MasterDashboardResponse> {
  return masterApi<MasterDashboardResponse>('/dashboard');
}

export function fetchMasterSummary(): Promise<MasterSummaryResponse> {
  return masterApi<MasterSummaryResponse>('/summary');
}

export function fetchMasterLogs(limit = 100): Promise<MasterLogsResponse> {
  return masterApi<MasterLogsResponse>(`/logs?limit=${Math.max(1, limit)}`);
}

export function fetchMasterHealth(): Promise<MasterHealthResponse> {
  return masterApi<MasterHealthResponse>('/health');
}

export function fetchMasterTenants(query = ''): Promise<unknown> {
  const q = query.trim() ? `?${query.replace(/^\?/, '')}` : '';
  return masterApi(`/tenants${q}`);
}

export type MasterAuditQueryParams = {
  from?: string;
  to?: string;
  companyId?: string;
  actor?: string;
  ip?: string;
  action?: string;
  resource?: string;
  result?: 'success' | 'failure' | 'all';
  limit?: number;
  offset?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
};

export type MasterAuditPagination = {
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
  nextCursor: string | null;
  hasMore: boolean;
};

export type MasterAuditResponse = {
  ok: boolean;
  audit: Array<Record<string, unknown>>;
  count: number;
  pagination: MasterAuditPagination;
  persistence: 'in_memory' | 'postgres';
};

/** Consulta paginada/filtrada da auditoria Master (Fase 5.2). */
export function fetchMasterAudit(
  params: MasterAuditQueryParams = {},
): Promise<MasterAuditResponse> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const query = qs.toString();
  return masterApi<MasterAuditResponse>(`/audit${query ? `?${query}` : ''}`);
}

export function fetchMasterLicenses(): Promise<unknown> {
  return masterApi('/licenses');
}

export function fetchMasterSubscriptions(): Promise<unknown> {
  return masterApi('/subscriptions');
}

export function fetchMasterBilling(): Promise<unknown> {
  return masterApi('/billing');
}
