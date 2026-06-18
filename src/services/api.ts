import { normalizeApiBase as normalizeApiBaseFromEnv } from '../config/env';
import { clearToken, getToken, isCookieSessionToken, setToken } from './authToken';
import { getCsrfToken } from './csrfToken';
import { logger } from '../shared/logger/logger';
import { observabilityConsole } from '../shared/logger/observabilityConsole';

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;
/** Definido após o primeiro 403 `data_api_writes_disabled` da API genérica `/data`. */
let dataApiWritesDisabledFlag = false;
let apiRateLimitedUntil = 0;

export function isApiRateLimited(): boolean {
  return Date.now() < apiRateLimitedUntil;
}

function markApiRateLimited(ms = 90_000): void {
  apiRateLimitedUntil = Date.now() + ms;
  try {
    sessionStorage.setItem('pontowebdesk:api_rate_limited_until', String(apiRateLimitedUntil));
  } catch {
    /* ignore */
  }
}

function readPersistedRateLimit(): void {
  try {
    const v = Number(sessionStorage.getItem('pontowebdesk:api_rate_limited_until'));
    if (Number.isFinite(v) && v > Date.now()) apiRateLimitedUntil = v;
  } catch {
    /* ignore */
  }
}

export function isDataApiWritesDisabled(): boolean {
  return dataApiWritesDisabledFlag;
}

function authFailureCode(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  const error = typeof record.error === 'string' ? record.error : '';
  return (code || error).trim();
}

function isDataWritePath(path: string): boolean {
  const p = path.startsWith('/api/') ? path.slice(4) : path;
  return p.startsWith('/data/') || p === '/data';
}

export function isDataApiWritesDisabledResponse(
  status: number,
  body: unknown,
  context?: { method?: string; path?: string },
): boolean {
  if (status !== 403) return false;
  if (authFailureCode(body) === 'data_api_writes_disabled') return true;
  const method = context?.method?.toUpperCase() ?? '';
  const path = context?.path ?? '';
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && path && isDataWritePath(path)) {
    return true;
  }
  return false;
}

export function isDataApiWritesDisabledError(error: unknown): boolean {
  return error instanceof ApiError && isDataApiWritesDisabledResponse(error.status, error.body);
}

function markDataApiWritesDisabled(): void {
  dataApiWritesDisabledFlag = true;
  try {
    sessionStorage.setItem('pontowebdesk:data_api_writes_disabled', '1');
  } catch {
    /* ignore */
  }
}

function readPersistedWritesDisabled(): boolean {
  try {
    return sessionStorage.getItem('pontowebdesk:data_api_writes_disabled') === '1';
  } catch {
    return false;
  }
}

/** Escritas genéricas POST/PATCH em `/api/data` (ex.: snapshots opcionais). */
export function isGenericDataApiWriteAllowed(): boolean {
  if (dataApiWritesDisabledFlag || readPersistedWritesDisabled()) return false;
  const envFlag = String(import.meta.env.VITE_DATA_API_WRITES_ENABLED ?? '').trim().toLowerCase();
  if (envFlag === 'true') return true;
  if (envFlag === 'false') return false;
  // VPS remota: DATA_API_WRITES_ENABLED=false por padrão no backend.
  return /localhost|127\.0\.0\.1/i.test(API_BASE);
}

// Restaura flags da sessão.
dataApiWritesDisabledFlag = readPersistedWritesDisabled();
readPersistedRateLimit();

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

/** VPS remota: evita tempestade de POST 403 antes do primeiro erro explícito. */
if (
  String(import.meta.env.VITE_DATA_API_WRITES_ENABLED ?? '').trim().toLowerCase() !== 'true' &&
  !/localhost|127\.0\.0\.1/i.test(API_BASE)
) {
  markDataApiWritesDisabled();
}

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

function isInvalidSessionBearer(value: string | undefined): boolean {
  const auth = String(value || '').trim();
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return isCookieSessionToken(token);
}

function sanitizeExtraHeaders(extra?: Record<string, string>): Record<string, string> {
  if (!extra) return {};
  const next = { ...extra };
  if (isInvalidSessionBearer(next.Authorization) || isInvalidSessionBearer(next.authorization)) {
    delete next.Authorization;
    delete next.authorization;
  }
  return next;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  const csrf = getCsrfToken();
  return {
    ...(token && !isCookieSessionToken(token) ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    ...sanitizeExtraHeaders(extra),
  };
}

/** Headers para fetch manual (REP sync-status, etc.) com cookie HttpOnly + CSRF. */
export function buildSessionAuthHeaders(
  accessToken?: string | null,
  extra?: Record<string, string>,
): Record<string, string> {
  const token = String(accessToken ?? getToken() ?? '').trim();
  const csrf = getCsrfToken();
  return {
    ...(token && !isCookieSessionToken(token) ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    ...sanitizeExtraHeaders(extra),
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

function shouldClearSessionOnUnauthorized(body: unknown): boolean {
  const code = authFailureCode(body);
  // missing_token = requisição sem credencial; não equivale a sessão revogada (evita logout pós-login).
  return (
    code === 'AUTH_INVALID_TOKEN' ||
    code === 'AUTH_TOKEN_EXPIRED' ||
    code === 'AUTH_TOKEN_REVOKED' ||
    code === 'AUTH_USER_NOT_FOUND' ||
    code === 'AUTH_TENANT_CHANGED' ||
    code === 'invalid_token' ||
    code === 'token_expired' ||
    code === 'token_revoked' ||
    code === 'user_not_found' ||
    code === 'tenant_changed'
  );
}

function payloadKeys(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  return Object.keys(body as Record<string, unknown>).sort();
}

function responseStack(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.stack === 'string') return record.stack;
  const details = record.details;
  if (details && typeof details === 'object') {
    const originalError = (details as Record<string, unknown>).originalError;
    if (originalError && typeof originalError === 'object') {
      const stack = (originalError as Record<string, unknown>).stack;
      if (typeof stack === 'string') return stack;
    }
  }
  return undefined;
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
    if (status === 401 && shouldClearSessionOnUnauthorized(body)) {
      const code = authFailureCode(body);
      observabilityConsole.info('[AUTH-FLOW] API 401', {
        path: normalizeApiPath(context.path),
        code,
        triggersLogout: true,
      });
      clearToken();
      observabilityConsole.info('[AUTH-FLOW] TOKEN REMOVED', { source: 'api.parseResponse', code });
      unauthorizedHandler?.();
    } else if (status === 403) {
      observabilityConsole.info('[AUTH-FLOW] API 403', {
        path: normalizeApiPath(context.path),
        code: authFailureCode(body),
      });
    }
    const errMsg = extractApiErrorMessage(body, status);
    const writesDisabled = isDataApiWritesDisabledResponse(status, body, context);
    if (writesDisabled) {
      markDataApiWritesDisabled();
    }
    if (status === 429) {
      const retryAfterHeader =
        resLike && typeof resLike.headers?.get === 'function'
          ? Number(resLike.headers.get('retry-after'))
          : NaN;
      const cooldownMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? Math.min(retryAfterHeader * 1000, 180_000)
        : 90_000;
      markApiRateLimited(cooldownMs);
    }
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
    const missingToken =
      status === 401 && authFailureCode(body) === 'missing_token';
    if (status === 401 && normalizeApiPath(context.path) === '/auth/me') {
      console.warn(consoleMessage, errorContext);
    } else if (missingToken && context.method === 'GET') {
      observabilityConsole.info('[API] GET sem sessão (ignorado)', errorContext);
    } else if (writesDisabled) {
      observabilityConsole.info('[API] DATA_API_WRITES_DISABLED (expected)', errorContext);
    } else if (status === 429) {
      observabilityConsole.warn('[API] RATE LIMITED — cooldown ativo', errorContext);
    } else {
      console.error(consoleMessage, errorContext);
      if (context.method === 'PATCH' || context.method === 'PUT') {
        console.error('UPDATE FAILURE', {
          endpoint: context.path,
          payload: context.requestBody,
          response: body,
          status,
          error: errMsg,
          stack: responseStack(body),
        });
      }
    }
    if (writesDisabled) {
      logger.info({
        module: 'frontend.api',
        action: 'DATA_API_WRITES_DISABLED',
        message: errMsg,
        correlationId: currentCorrelationId || undefined,
        meta: {
          method: context.method,
          path: context.path,
          url: context.url,
          status,
        },
      });
    } else if (status === 429) {
      logger.warn({
        module: 'frontend.api',
        action: 'API_RATE_LIMITED',
        message: errMsg,
        correlationId: currentCorrelationId || undefined,
        meta: {
          method: context.method,
          path: context.path,
          url: context.url,
          status,
          cooldown_until: apiRateLimitedUntil,
        },
      });
    } else {
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
    }
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
      ...sanitizeExtraHeaders(init?.headers as Record<string, string> | undefined),
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
      ...sanitizeExtraHeaders(init?.headers as Record<string, string> | undefined),
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
      ...sanitizeExtraHeaders(init?.headers as Record<string, string> | undefined),
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
      ...sanitizeExtraHeaders(init?.headers as Record<string, string> | undefined),
    },
  });
  return parseResponse<T>(res, { method: 'DELETE', path, url });
}

/** @deprecated use getToken from authToken.ts */
export function getApiAuthHeaders(): Record<string, string> {
  return authHeaders();
}

export { clearToken, getToken, setToken };
