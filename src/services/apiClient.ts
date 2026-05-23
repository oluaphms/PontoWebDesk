/**
 * Cliente HTTP único do frontend → API VPS.
 */
export {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  API_BASE,
  buildApiUrl,
  getApiBaseUrl,
  normalizeApiBase,
  ApiError,
  type ApiResult,
} from './api';

export { clearToken, getToken, setToken } from './authToken';
