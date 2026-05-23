/**
 * Cliente HTTP único do frontend → API VPS.
 */
export {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  getApiBaseUrl,
  ApiError,
  type ApiResult,
} from './api';

export { clearToken, getToken, setToken } from './authToken';
