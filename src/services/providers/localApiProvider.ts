import type { IDataProvider, ProviderLoginParams, ProviderPunchPayload } from '../dataProvider';
import { apiPost } from '../api';
import { getToken, setToken } from '../authToken';
import { fetchEmployees } from '../employeesApi.service';

export const localApiProvider: IDataProvider = {
  async login(params: ProviderLoginParams): Promise<any> {
    const data = (await apiPost('/auth/login', params)) as Record<string, unknown>;
    if (!data?.ok) {
      throw new Error(String(data?.error || 'Falha no login'));
    }
    setToken(typeof data.token === 'string' ? data.token : null);
    return data;
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

  async getAccessToken(): Promise<string | null> {
    return getToken();
  },
};
