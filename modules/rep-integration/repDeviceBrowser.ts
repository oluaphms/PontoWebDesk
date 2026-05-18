/**
 * Chamadas ao relógio via backend same-origin (/api/rep/*) — uso apenas no browser.
 */

import type { PunchFromDevice, RepDeviceClockSet, RepExchangeOp, RepUserFromDevice } from './types';

function apiOrigin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

/** Evita que o modal «Enviar e Receber» fique sem resposta se o proxy/rede travar. */
async function fetchWithRepTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const c = new AbortController();
  const tid = setTimeout(() => c.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: c.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(
        `Tempo esgotado (${Math.round(timeoutMs / 1000)}s) na chamada ao servidor REP. O relógio pode estar lento, inacessível ou o AFD é muito grande.`
      );
    }
    throw e;
  } finally {
    clearTimeout(tid);
  }
}

/** Resposta JSON ou HTML/texto (ex.: 502/500 da CDN) sem quebrar o parse. */
async function readJsonOrText(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { _raw: text.slice(0, 500) };
  }
}

/**
 * Vercel e outros proxies podem devolver `error` como string ou `{ code, message }`.
 * React não pode renderizar objetos — sempre produzir string.
 */
function normalizeApiError(data: Record<string, unknown>, status: number): string {
  const pick = (v: unknown, depth = 0): string | null => {
    if (depth > 5) return null;
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.message === 'string' && o.message.trim()) return o.message;
      if (typeof o.error === 'string') return o.error;
      const nested = pick(o.error, depth + 1) ?? pick(o.details, depth + 1) ?? pick(o.hint, depth + 1);
      if (nested) return nested;
    }
    return null;
  };

  const fromFields =
    pick(data.error) ?? pick(data.message) ?? pick(data.details) ?? (typeof data._raw === 'string' ? data._raw : null);
  if (fromFields) return fromFields;
  try {
    const s = JSON.stringify(data);
    if (s !== '{}') return s.length > 400 ? `${s.slice(0, 400)}…` : s;
  } catch {
    /* ignore */
  }
  return `HTTP ${status}`;
}

/** Garante string para UI (evita React #31 se a API devolver objeto em message/error). */
export function toUiString(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
    /** PostgREST / Supabase: às vezes só há `code` + `details` */
    if (typeof o.code === 'string' && typeof o.details === 'string') {
      return `${o.code}: ${o.details}`;
    }
  }
  try {
    const s = JSON.stringify(v);
    return s.length > 520 ? `${s.slice(0, 520)}…` : s;
  } catch {
    return fallback;
  }
}

const PUNCHES_FETCH_TIMEOUT_MS = 240_000;

export async function fetchPunchesViaApi(
  deviceId: string,
  since: Date | undefined,
  accessToken: string
): Promise<PunchFromDevice[]> {
  const u = new URL('/api/rep/punches', apiOrigin());
  u.searchParams.set('device_id', deviceId);
  if (since) u.searchParams.set('since', since.toISOString());
  const res = await fetchWithRepTimeout(
    u.toString(),
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    },
    PUNCHES_FETCH_TIMEOUT_MS
  );
  const data = await readJsonOrText(res);
  if (!res.ok) {
    throw new Error(normalizeApiError(data, res.status));
  }
  if (data.ok === false) {
    throw new Error(
      normalizeApiError(data, res.status) || 'Falha ao obter marcações do relógio'
    );
  }
  return Array.isArray(data.punches) ? (data.punches as PunchFromDevice[]) : [];
}

export async function testConnectionViaApi(deviceId: string, accessToken: string): Promise<{ ok: boolean; message: string }> {
  const u = new URL('/api/rep/status', apiOrigin());
  u.searchParams.set('device_id', deviceId);
  const res = await fetchWithRepTimeout(
    u.toString(),
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    },
    90_000
  );
  const data = await readJsonOrText(res);
  const errText = normalizeApiError(data, res.status);
  if (!res.ok) {
    if (res.status >= 500) {
      return { ok: false, message: 'Não foi possível conectar ao dispositivo.' };
    }
    return { ok: false, message: errText || 'Não foi possível conectar ao dispositivo.' };
  }
  if (data.ok === false) {
    return {
      ok: false,
      message: normalizeApiError(data, res.status) || 'Falha ao contatar o relógio',
    };
  }
  return { ok: true, message: toUiString(data.message, 'Conexão OK') };
}

/** Cadastra funcionário no relógio (fabricante com suporte, ex.: Control iD). */
export async function pushEmployeeToDeviceViaApi(
  deviceId: string,
  userId: string,
  accessToken: string
): Promise<{ ok: boolean; message: string }> {
  const u = new URL('/api/rep/push-employee', apiOrigin());
  const res = await fetchWithRepTimeout(
    u.toString(),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_id: deviceId, user_id: userId }),
    },
    120_000
  );
  const data = await readJsonOrText(res);
  if (!res.ok) {
    return { ok: false, message: normalizeApiError(data, res.status) };
  }
  if (data.ok === false) {
    return {
      ok: false,
      message: normalizeApiError(data, res.status) || 'Falha ao enviar funcionário ao relógio',
    };
  }
  return { ok: true, message: toUiString(data.message, 'Funcionário enviado ao relógio.') };
}

/** Envia/recebe dados auxiliares (hora, info, lista de usuários no relógio). */
export async function repExchangeViaApi(
  deviceId: string,
  op: RepExchangeOp,
  accessToken: string,
  clock?: RepDeviceClockSet
): Promise<{
  ok: boolean;
  message?: string;
  data?: unknown;
  users?: RepUserFromDevice[];
  error?: string;
}> {
  const u = new URL('/api/rep/exchange', apiOrigin());
  const res = await fetchWithRepTimeout(
    u.toString(),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_id: deviceId, op, ...(clock ? { clock } : {}) }),
    },
    180_000
  );
  const data = await readJsonOrText(res);
  if (!res.ok) {
    return { ok: false, error: normalizeApiError(data, res.status) };
  }
  if (data.ok === false) {
    const err = normalizeApiError(data, res.status) || 'Operação não concluída.';
    return { ok: false, message: err, error: err, data: data.data, users: data.users as RepUserFromDevice[] | undefined };
  }
  const okMsg = data.message != null ? toUiString(data.message) : '';
  return {
    ok: true,
    message: okMsg || undefined,
    data: data.data,
    users: data.users as RepUserFromDevice[] | undefined,
  };
}
