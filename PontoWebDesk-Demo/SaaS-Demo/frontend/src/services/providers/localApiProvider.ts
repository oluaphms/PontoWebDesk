import type { IDataProvider, ProviderLoginParams, ProviderPunchPayload } from '../dataProvider';
import { ApiError, apiPost, buildApiUrl, getApiBaseUrl } from '../api';
import { getToken, isCookieSessionToken, setToken } from '../authToken';
import { setCsrfToken } from '../csrfToken';
import { beginPostLoginQueryCooldown } from '../../app/postLoginQueryGate';
import { fetchEmployees } from '../employeesApi.service';
import {
  isCommercialBlockedCode,
  redirectToLicenseBlocked,
} from '../commercialBlockRedirect';

function extractErrorCode(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  return String(record.code || record.error || '').trim();
}

export const localApiProvider: IDataProvider = {
  async login(params: ProviderLoginParams): Promise<any> {
    const endpoint = '/auth/login';
    console.info('LOGIN_PROVIDER_SELECTED', { provider: 'LOCAL_API' });
    console.info('LOGIN_ENDPOINT', { endpoint: '/api/auth/login' });
    console.info('LOGIN_PAYLOAD', {
      identifier: String(params.identifier || '').trim().toLowerCase(),
      hasPassword: Boolean(params.password),
    });
    try {
      const data = (await apiPost(endpoint, params)) as Record<string, unknown>;
      if (!data?.ok) {
        throw new Error(String(data?.message || data?.error || data?.code || 'Falha no login'));
      }
      const token = String(data?.token || '').trim();
      const csrfToken = String(data?.csrfToken || '').trim();
      if (!token) {
        console.warn('[AUTH-FLOW] LOGIN_NO_TOKEN_IN_BODY', {
          hint: 'Em localhost cross-port o cookie pode falhar; o body deve trazer JWT.',
        });
      }
      setToken(token || '__http_only_cookie_session__');
      if (csrfToken) setCsrfToken(csrfToken);
      beginPostLoginQueryCooldown('local_api_login');
      console.info('[AUTH-FLOW] TOKEN SAVED', {
        mode: token ? 'bearer' : 'cookie',
        userId: (data.user as Record<string, unknown> | undefined)?.id ?? null,
        hasTokenInBody: Boolean(token),
      });
      return data;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      const code = extractErrorCode(apiError?.body);
      if (isCommercialBlockedCode(code)) {
        redirectToLicenseBlocked(
          typeof (apiError?.body as Record<string, unknown> | null)?.message === 'string'
            ? String((apiError?.body as Record<string, unknown>).message)
            : null,
        );
      }
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
