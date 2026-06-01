import { normalizeApiBase as normalizeApiBaseFromEnv } from '../config/env';
import { clearToken, getToken, isCookieSessionToken, setToken } from './authToken';
import { logger } from '../shared/logger/logger';

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registra callback global para 401 (logout automático). */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/**
 * Base da API VPS — derivada de `VITE_API_URL` (deve terminar em `/api`).
 * Se o env vier só com o host (ex.: `https://api.phmsdev.com.br`), acrescenta `/api`.
 */
export function normalizeApiBase(raw?: string): string {
  return normalizeApiBaseFromEnv(raw);
}

/** Base normalizada usada por todas as funções HTTP do frontend. */
export const API_BASE = normalizeApiBase();
let currentCorrelationId: string | null = null;

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

export function getCorrelationId(): string | null {
  return currentCorrelationId;
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
  method?: string;
  path?: string;
  url?: string;
  correlationId?: string | null;

  constructor(
    message: string,
    status: number,
    body: unknown,
    context?: { method?: string; path?: string; url?: string; correlationId?: string | null },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.method = context?.method;
    this.path = context?.path;
    this.url = context?.url;
    this.correlationId = context?.correlationId;
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(token && !isCookieSessionToken(token) ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}

function extractApiErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = record.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
    const error = record.error;
    if (typeof error === 'string' && error.trim()) return error.trim();
    const code = record.code;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return `HTTP ${status}`;
}

function payloadKeys(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  return Object.keys(body as Record<string, unknown>).sort();
}

async function parseResponse<T>(
  res: Response,
  context: { method: string; path: string; url: string; requestBody?: unknown },
): Promise<T> {
  const resLike = res as unknown as {
    ok?: boolean;
    status?: number;
    headers?: { get?: (name: string) => string | null };
    text?: () => Promise<string>;
    json?: () => Promise<unknown>;
  };
  const headerCorrelationId =
    resLike && typeof resLike.headers?.get === 'function'
      ? resLike.headers.get('x-correlation-id')
      : null;
  if (headerCorrelationId) currentCorrelationId = headerCorrelationId;

  let text = '';
  if (typeof resLike.text === 'function') {
    text = await resLike.text();
  }
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = { error: text };
    }
  } else if (typeof resLike.json === 'function') {
    try {
      body = await resLike.json();
    } catch {
      body = null;
    }
  }
  const status = typeof resLike.status === 'number' ? resLike.status : 200;
  const ok = typeof resLike.ok === 'boolean' ? resLike.ok : status >= 200 && status < 300;
  if (!ok) {
    if (status === 401) {
      clearToken();
      unauthorizedHandler?.();
    }
    const errMsg = extractApiErrorMessage(body, status);
    const errorContext = {
      method: context.method,
      path: context.path,
      url: context.url,
      status,
      body,
      payloadKeys: payloadKeys(context.requestBody),
      correlationId: currentCorrelationId || undefined,
    };
    const consoleMessage = `API ERROR ${context.method} ${context.path} ${status}: ${errMsg}`;
    if (status === 401 && normalizeApiPath(context.path) === '/auth/me') {
      console.warn(consoleMessage, errorContext);
    } else {
      console.error(consoleMessage, errorContext);
    }
    logger.error({
      module: 'frontend.api',
      action: 'API_REQUEST_FAILED',
      message: errMsg,
      correlationId: currentCorrelationId || undefined,
      meta: {
        method: context.method,
        path: context.path,
        url: context.url,
        status,
        response: body,
        payloadKeys: payloadKeys(context.requestBody),
      },
    });
    throw new ApiError(errMsg, status, body, {
      method: context.method,
      path: context.path,
      url: context.url,
      correlationId: currentCorrelationId,
    });
  }
  return body as T;
}

export async function apiGet<T = ApiResult>(path: string, init?: RequestInit): Promise<T> {
  const requestCorrelationId = currentCorrelationId || crypto.randomUUID();
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    ...init,
    method: 'GET',
    credentials: 'include',
    headers: {
      ...authHeaders(),
      'x-correlation-id': requestCorrelationId,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  return parseResponse<T>(res, { method: 'GET', path, url });
}

export async function apiPost<T = ApiResult>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const requestCorrelationId = currentCorrelationId || crypto.randomUUID();
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    ...init,
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      'x-correlation-id': requestCorrelationId,
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res, { method: 'POST', path, url, requestBody: body });
}

export async function apiPatch<T = ApiResult>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const requestCorrelationId = currentCorrelationId || crypto.randomUUID();
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    ...init,
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      'x-correlation-id': requestCorrelationId,
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res, { method: 'PATCH', path, url, requestBody: body });
}

export async function apiDelete<T = ApiResult>(path: string, init?: RequestInit): Promise<T> {
  const requestCorrelationId = currentCorrelationId || crypto.randomUUID();
  const url = buildApiUrl(path);
  const res = await fetch(url, {
    ...init,
    method: 'DELETE',
    credentials: 'include',
    headers: {
      ...authHeaders(),
      'x-correlation-id': requestCorrelationId,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  return parseResponse<T>(res, { method: 'DELETE', path, url });
}

/** @deprecated use getToken from authToken.ts */
export function getApiAuthHeaders(): Record<string, string> {
  return authHeaders();
}

export { clearToken, getToken, setToken };
