import { getApiBaseUrl } from '../services/api';

export function getApiConfig(): { baseUrl: string } {
  return { baseUrl: getApiBaseUrl() };
}
