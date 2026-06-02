import type { IDataProvider, ProviderLoginParams, ProviderPunchPayload } from '../dataProvider';
import { ApiError, apiPost, buildApiUrl, getApiBaseUrl } from '../api';
import { getToken, isCookieSessionToken, setToken } from '../authToken';
import { fetchEmployees } from '../employeesApi.service';

export const localApiProvider: IDataProvider = {
  async login(params: ProviderLoginParams): Promise<any> {
    const endpoint = '/auth/login';
    try {
      const data = (await apiPost(endpoint, params)) as Record<string, unknown>;
      if (!data?.ok) {
        throw new Error(String(data?.message || data?.error || data?.code || 'Falha no login'));
      }
      const token = String(data?.token || '').trim();
      setToken(token || 'cookie');
      return data;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      console.error('LOGIN FAILURE', {
        apiUrl: getApiBaseUrl(),
        endpoint: buildApiUrl(endpoint),
        method: 'POST',
        requestPayload: {
          identifier: params.identifier,
          hasPassword: Boolean(params.password),
        },
        error: error instanceof Error ? error.message : String(error),
        response: apiError?.body,
        status: apiError?.status,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  },

  async getEmployees(companyId: string): Promise<Record<string, unknown>[]> {
    const rows = await fetchEmployees(companyId);
    return rows as Record<string, unknown>[];
  },

  async registerPunch(payload: ProviderPunchPayload): Promise<any> {
    return apiPost('/punches', payload);
  },

  async registerPunchBatch(payload: { punches: ProviderPunchPayload[] }): Promise<any> {
    return apiPost('/punches/batch', payload);
  },

  async updatePassword(newPassword: string): Promise<any> {
    return apiPost('/auth/change-password', { newPassword });
  },

  async getAccessToken(): Promise<string | null> {
    const token = getToken();
    return isCookieSessionToken(token) ? null : token;
  },
};
