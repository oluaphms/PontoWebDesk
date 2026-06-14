/**
 * Chamadas ao relógio via backend same-origin (/api/rep/*) — uso apenas no browser.
 */

import type { PunchFromDevice, RepDeviceClockSet, RepExchangeOp, RepUserFromDevice } from './types';
import { buildApiUrl, buildSessionAuthHeaders } from '../../src/services/api';
import { pollRepCommandResult } from '../../src/services/repDeviceCommands.service';

function repAuthInit(accessToken: string, method: 'GET' | 'POST'): RequestInit {
  return {
    method,
    credentials: 'include',
    headers: {
      ...buildSessionAuthHeaders(accessToken),
      Accept: 'application/json',
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
  };
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
  } catch (error) {
    void error;
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
  } catch (error) {
    void error;
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
  } catch (error) {
    void error;
    return fallback;
  }
}

const PUNCHES_FETCH_TIMEOUT_MS = 240_000;

export async function fetchPunchesViaApi(
  deviceId: string,
  since: Date | undefined,
  accessToken: string
): Promise<PunchFromDevice[]> {
  const u = new URL(buildApiUrl('/rep/punches'));
  u.searchParams.set('device_id', deviceId);
  if (since) u.searchParams.set('since', since.toISOString());
  const res = await fetchWithRepTimeout(
    u.toString(),
    repAuthInit(accessToken, 'GET'),
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
  const u = new URL(buildApiUrl('/rep/status'));
  u.searchParams.set('device_id', deviceId);
  const res = await fetchWithRepTimeout(
    u.toString(),
    repAuthInit(accessToken, 'GET'),
    90_000
  );
  const data = await readJsonOrText(res);
  const errText = normalizeApiError(data, res.status);
  if (!res.ok) {
    if (res.status === 404 && errText === 'not_found') {
      return {
        ok: false,
        message:
          'Rota /rep/status não encontrada no servidor. Atualize o backend ou use teste via agente.',
      };
    }
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
  const u = new URL(buildApiUrl('/rep/push-employee'));
  const res = await fetchWithRepTimeout(
    u.toString(),
    {
      ...repAuthInit(accessToken, 'POST'),
      body: JSON.stringify({ device_id: deviceId, user_id: userId }),
    },
    120_000
  );
  const data = await readJsonOrText(res);
  if (!res.ok) {
    const err = normalizeApiError(data, res.status);
    return {
      ok: false,
      message:
        err === 'internal_error' ||
          err === 'push_employee_failed' ||
          err === 'command_enqueue_failed'
          ? toUiString(data.message, 'Não foi possível enfileirar o envio do colaborador ao relógio.')
          : err,
    };
  }
  if (data.ok === false) {
    const err = normalizeApiError(data, res.status) || 'Falha ao enviar funcionário ao relógio';
    return {
      ok: false,
      message:
        err === 'internal_error' ||
          err === 'push_employee_failed' ||
          err === 'command_enqueue_failed'
          ? toUiString(data.message, 'Não foi possível enfileirar o envio do colaborador ao relógio.')
          : err,
    };
  }
  if (typeof data.command_id === 'string' && data.command_id) {
    return {
      ok: true,
      message: 'Envio de funcionário enfileirado para o agente local. Aguarde o próximo ciclo do agente.',
    };
  }
  return { ok: true, message: toUiString(data.message, 'Funcionário enviado ao relógio.') };
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function pad2(n: unknown): string {
  return String(n ?? '0').padStart(2, '0');
}

/** Formata resposta do Control iD get_system_date_time para exibição. */
export function formatRepClockDataForDisplay(data: unknown): string {
  if (data == null) return '—';
  if (typeof data === 'string') {
    const t = data.trim();
    if (isUuidLike(t)) {
      return 'Resposta inválida (ID de comando). Aguarde o agente concluir a leitura ou tente novamente.';
    }
    return t;
  }
  if (typeof data === 'object' && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    if (o.day != null && o.month != null && o.year != null) {
      return `${pad2(o.day)}/${pad2(o.month)}/${o.year} ${pad2(o.hour)}:${pad2(o.minute)}:${pad2(o.second)}`;
    }
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/** Control iD usa `name`; UI espera `nome`. */
export function normalizeRepUsersFromDevice(raw: unknown): RepUserFromDevice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      const nome = String(o.nome ?? o.name ?? '').trim();
      const pis = o.pis != null ? String(o.pis).trim() : '';
      const cpf = o.cpf != null ? String(o.cpf).trim() : '';
      const matricula = String(o.matricula ?? o.registration ?? '').trim();
      return {
        nome: nome || '—',
        pis: pis || undefined,
        cpf: cpf || undefined,
        matricula: matricula || undefined,
        raw: o,
      };
    })
    .filter((u) => u.nome !== '—' || u.pis || u.cpf || u.matricula);
}

function extractExchangeFromCommandResult(result: Record<string, unknown> | null | undefined): {
  ok: boolean;
  message: string;
  data?: unknown;
  users?: RepUserFromDevice[];
} {
  const r = result && typeof result === 'object' ? result : {};
  const success = r.success !== false && r.ok !== false;
  const message = toUiString(r.message, success ? 'Operação concluída.' : 'Operação falhou.');
  const users = normalizeRepUsersFromDevice(r.users);
  const data = r.data ?? (users.length ? undefined : null);
  return { ok: success, message, data, users: users.length ? users : undefined };
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
  const u = new URL(buildApiUrl('/rep/exchange'));
  const res = await fetchWithRepTimeout(
    u.toString(),
    {
      ...repAuthInit(accessToken, 'POST'),
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
  if (typeof data.command_id === 'string' && data.command_id) {
    const polled = await pollRepCommandResult(deviceId, data.command_id, accessToken);
    if (!polled.ok) {
      return {
        ok: false,
        error: polled.message,
        message: polled.message,
      };
    }
    const parsed = extractExchangeFromCommandResult(
      (polled.command.result as Record<string, unknown> | null | undefined) ?? null,
    );
    if (!parsed.ok) {
      return { ok: false, message: parsed.message, error: parsed.message };
    }
    return {
      ok: true,
      message: parsed.message,
      data: parsed.data,
      users: parsed.users,
    };
  }
  const okMsg = data.message != null ? toUiString(data.message) : '';
  const directUsers = normalizeRepUsersFromDevice(data.users);
  return {
    ok: true,
    message: okMsg || undefined,
    data: data.data,
    users: directUsers.length ? directUsers : (data.users as RepUserFromDevice[] | undefined),
  };
}
