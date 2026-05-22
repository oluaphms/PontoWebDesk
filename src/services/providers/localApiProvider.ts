import type { IDataProvider, ProviderLoginParams, ProviderPunchPayload } from '../dataProvider';
import { httpRequest } from '../httpClient';

const API_BASE = (import.meta.env.VITE_LOCAL_API_BASE_URL as string | undefined)?.trim() || '';
const ACCESS_TOKEN_KEY = 'pontoweb:local_api_token';

function buildUrl(path: string): string {
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/+$/, '')}${path}`;
}

function writeAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!token) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      return;
    }
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await localApiProvider.getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const localApiProvider: IDataProvider = {
  async login(params: ProviderLoginParams): Promise<any> {
    const data = await httpRequest(buildUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!data?.ok) {
      throw new Error(data?.error || 'Falha no login local API');
    }
    writeAccessToken(typeof data.token === 'string' ? data.token : null);
    return data;
  },

  async getEmployees(companyId: string): Promise<Record<string, unknown>[]> {
    const headers = await authHeaders();
    const url = new URL(buildUrl('/api/employees'), window.location.origin);
    if (companyId) {
      url.searchParams.set('companyId', companyId);
    }
    const data = await httpRequest(url.toString(), { headers });
    if (!data?.ok && !data?.employees) return [];
    return data?.employees ?? [];
  },

  async registerPunch(payload: ProviderPunchPayload): Promise<any> {
    const headers = await authHeaders();
    const res = await httpRequest(buildUrl('/api/punches'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    return res ?? { ok: false, degraded: true };
  },

  async registerPunchBatch(payload: { punches: ProviderPunchPayload[] }): Promise<any> {
    const headers = await authHeaders();
    const res = await httpRequest(buildUrl('/api/punches/batch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    return res ?? { ok: false, degraded: true };
  },

  async getAccessToken(): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(ACCESS_TOKEN_KEY);
    } catch {
      return null;
    }
  },
};

