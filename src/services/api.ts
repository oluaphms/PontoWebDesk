import { clearToken, getToken, setToken } from './authToken';

const DEFAULT_API_BASE = 'http://177.7.51.209/api';

function readEnvApiUrl(): string {
  return (
    (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_LOCAL_API_BASE_URL as string | undefined)?.trim() ||
    ''
  );
}

/**
 * Base da API VPS — derivada de `VITE_API_URL` (deve terminar em `/api`).
 * Se o env vier só com o host (ex.: `https://api.phmsdev.com.br`), acrescenta `/api`.
 */
export function normalizeApiBase(raw?: string): string {
  const trimmed = (raw ?? readEnvApiUrl()).replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE;
  if (trimmed.endsWith('/api')) return trimmed;
  return `${trimmed}/api`;
}

/** Base normalizada usada por todas as funções HTTP do frontend. */
export const API_BASE = normalizeApiBase();

function normalizeApiPath(path: string): string {
  let p = path.trim();
  if (!p) return '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p === '/api') return '/';
  if (p.startsWith('/api/')) p = p.slice(4);
  return p.startsWith('/') ? p : `/${p}`;
}

/** Monta URL absoluta: `${API_BASE}${path}` — path relativo sem prefixo `/api` duplicado. */
export function buildApiUrl(path: string): string {
  return `${API_BASE}${normalizeApiPath(path)}`;
}

export function getApiBaseUrl(): string {
  return API_BASE;
}

export type ApiResult<T = unknown> = {
  data?: T;
  error?: string;
  ok?: boolean;
  [key: string]: unknown;
};

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = { error: text };
    }
  }
  if (!res.ok) {
    const errMsg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as ApiResult).error)
        : `HTTP ${res.status}`;
    throw new ApiError(errMsg, res.status, body);
  }
  return body as T;
}

export async function apiGet<T = ApiResult>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(buildApiUrl(path), {
    ...init,
    method: 'GET',
    headers: {
      ...authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  return parseResponse<T>(res);
}

export async function apiPost<T = ApiResult>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(buildApiUrl(path), {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res);
}

export async function apiPatch<T = ApiResult>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(buildApiUrl(path), {
    ...init,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res);
}

export async function apiDelete<T = ApiResult>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(buildApiUrl(path), {
    ...init,
    method: 'DELETE',
    headers: {
      ...authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  return parseResponse<T>(res);
}

/** @deprecated use getToken from authToken.ts */
export function getApiAuthHeaders(): Record<string, string> {
  return authHeaders();
}

export { clearToken, getToken, setToken };
