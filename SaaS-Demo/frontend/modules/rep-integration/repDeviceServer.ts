/**
 * Acesso HTTP ao relógio REP apenas em ambiente servidor (Node, Vercel, agente).
 * Não importe no código do cliente (browser bundle).
 */

import '../timeclock/registerDefaultProviders';
import { getProvider, hasTimeClockProvider } from '../timeclock/factory/providerFactory';
import { TimeClockService } from '../timeclock/services/TimeClockService';
import {
  repDeviceToDeviceConfig,
  repEmployeePayloadToEmployeePayload,
  resolveTimeClockProviderKey,
} from '../timeclock/utils/dataAdapters';
import type {
  RepDevice,
  PunchFromDevice,
  RepConnectionTestResult,
  RepEmployeePayload,
  RepExchangeOp,
  RepDeviceClockSet,
  RepUserFromDevice,
} from './types';
import { deviceFetch } from './repDeviceHttp';
import { getVendorAdapter, registerVendorAdapter } from './repDeviceManager';
import ControlIdAdapter from './adapters/controlId';

const controlIdAdapter = ControlIdAdapter;
registerVendorAdapter('Control iD', controlIdAdapter);
registerVendorAdapter('Control ID', controlIdAdapter);
registerVendorAdapter('iDClass', controlIdAdapter);
registerVendorAdapter('ControliD', controlIdAdapter);

const CONNECT_TIMEOUT_MS = 10000;

/** RFC1918 / loopback — servidor na nuvem não alcança (sem túnel/VPN). */
export function isPrivateOrLocalIPv4(ip: string): boolean {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  const n = parts.map((p) => parseInt(p, 10));
  if (n.some((x) => Number.isNaN(x) || x < 0 || x > 255)) return false;
  const [a, b] = n;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function cloudCannotReachLanHint(ip: string): string {
  if (!isPrivateOrLocalIPv4(ip)) return '';
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return (
      ' O IP é de rede local: o servidor na nuvem não alcança este relógio. ' +
      'Use o agente Node na empresa ou importação por arquivo (AFD).'
    );
  }
  return '';
}

/** Mensagem legível para falhas de fetch (Node costuma retornar só "fetch failed"). */
function formatDeviceFetchError(e: unknown): string {
  if (!(e instanceof Error)) return 'Falha de conexão com o relógio';
  const base = e.message || 'Falha de conexão';
  const withCause = e as Error & { cause?: unknown };
  const c = withCause.cause;
  let extra = '';
  if (c instanceof Error && c.message) {
    extra = c.message;
  } else if (c && typeof c === 'object') {
    const err = c as NodeJS.ErrnoException;
    if (err.code) extra = String(err.code);
    else if ('errno' in err) extra = `errno ${String((err as { errno?: unknown }).errno)}`;
  }
  const code = (e as NodeJS.ErrnoException).code;
  const parts = [base, extra, code ? `(${code})` : ''].filter(Boolean);
  const joined = parts.join(' ').trim();
  /** Cliente TLS falando com servidor HTTP na mesma porta (ou resposta binária inválida). */
  if (/packet length too long|tls_get_more_records|0A0000C6/i.test(joined)) {
    return (
      `${joined} — Em geral o app está usando HTTPS (TLS), mas nessa IP:porta o relógio responde em HTTP puro. ` +
      'Desmarque "Usar HTTPS" no cadastro e use a porta HTTP (ex.: 80 ou 8080), salve e teste de novo. ' +
      'Só marque HTTPS se o manual do fabricante disser TLS nessa porta.'
    );
  }
  if (
    /self-signed|certificate|unable to verify|UNABLE_TO_VERIFY|CERT_/i.test(joined) ||
    (/openssl/i.test(joined) && /alert|handshake|verify/i.test(joined))
  ) {
    return (
      `${joined} — Se o relógio usa HTTPS com certificado próprio, marque no cadastro ` +
      `"HTTPS" e "Aceitar certificado autoassinado" (somente rede interna), ou defina REP_DEVICE_TLS_INSECURE=1 no servidor.`
    );
  }
  if (/Invalid header value|does not match the HTTP\/1\.1 protocol/i.test(joined)) {
    return (
      `${joined} — O relógio respondeu com cabeçalhos HTTP fora do padrão (comum em firmware embarcado). ` +
      'Esta versão já usa um parser permissivo; se o erro persistir, confira IP/porta e se o protocolo (HTTP vs HTTPS) está correto.'
    );
  }
  if (/^fetch failed$/i.test(base) && !extra && !code) {
    return (
      'Não foi possível conectar ao relógio (fetch failed). Verifique IP/porta no cadastro, se o aparelho está na mesma rede que este PC, ' +
      'firewall e se o firmware expõe HTTP em /api/status ou /api/punches.'
    );
  }
  return joined;
}

async function fetchGenericPunches(device: RepDevice, since?: Date): Promise<PunchFromDevice[]> {
  if (device.tipo_conexao !== 'rede' || !device.ip) return [];
  const path = `/api/punches${since ? `?since=${encodeURIComponent(since.toISOString())}` : ''}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    const res = await deviceFetch(device, path, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : (data.punches || data.records || []);
  } catch (e: unknown) {
    clearTimeout(timeout);
    const msg = formatDeviceFetchError(e);
    throw new Error(`${msg}${cloudCannotReachLanHint(device.ip!)}`);
  }
}

/**
 * Marcações direto do relógio (adaptador do fabricante ou HTTP genérico).
 */
export async function getPunchesFromDeviceServer(device: RepDevice, since?: Date): Promise<PunchFromDevice[]> {
  const adapter = getVendorAdapter(device);
  if (adapter) {
    try {
      return await adapter.fetchPunches(device, since);
    } catch (e: unknown) {
      const msg = formatDeviceFetchError(e);
      throw new Error(`${msg}${device.ip ? cloudCannotReachLanHint(device.ip) : ''}`);
    }
  }
  if (device.tipo_conexao === 'rede') {
    return fetchGenericPunches(device, since);
  }
  return [];
}

export type FetchRawDevicePathOptions = {
  method?: 'GET' | 'POST';
  /** Corpo UTF-8 (normalmente JSON). Só com POST. */
  body?: string;
};

function repConfig(device: RepDevice): Record<string, unknown> {
  return device.config_extra && typeof device.config_extra === 'object'
    ? (device.config_extra as Record<string, unknown>)
    : {};
}

/** Caminho no relógio para teste de conexão (padrão /api/status). */
export function getRepStatusPath(device: RepDevice): string {
  const p = repConfig(device).status_path;
  if (typeof p === 'string' && p.startsWith('/')) return p;
  return '/api/status';
}

function getRepStatusPostBody(device: RepDevice): string {
  const b = repConfig(device).status_post_body;
  if (typeof b === 'string') return b;
  return '{}';
}

type StatusMethodPref = 'auto' | 'get' | 'post';

function getRepStatusMethodPref(device: RepDevice): StatusMethodPref {
  const ex = repConfig(device);
  if (ex.status_use_post === true) return 'post';
  const m = String(ex.status_method ?? '').toLowerCase();
  if (m === 'post') return 'post';
  if (m === 'get') return 'get';
  return 'auto';
}

/**
 * GET ou POST em path relativo no relógio (ex.: /api/status, /api/punches).
 */
export async function fetchRawDevicePath(
  device: RepDevice,
  relativePath: string,
  options?: FetchRawDevicePathOptions
): Promise<{ ok: boolean; status: number; body: unknown; message?: string }> {
  if (device.tipo_conexao !== 'rede' || !device.ip) {
    return { ok: false, status: 0, body: null, message: 'Dispositivo não configurado para rede (IP/porta).' };
  }
  const path = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const method = (options?.method || 'GET').toUpperCase() as 'GET' | 'POST';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const bodyStr = options?.body;
    if (method === 'POST' && bodyStr != null) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await deviceFetch(device, path, {
      method,
      signal: controller.signal,
      headers,
      body: method === 'POST' && bodyStr != null ? bodyStr : undefined,
    });
    clearTimeout(timeout);
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e: unknown) {
    clearTimeout(timeout);
    const msg = formatDeviceFetchError(e);
    return {
      ok: false,
      status: 0,
      body: null,
      message: `${msg}${cloudCannotReachLanHint(device.ip)}`,
    };
  }
}

function summarizeRepDeviceBody(body: unknown): string {
  if (body == null || body === '') return '';
  if (typeof body === 'string') return body.length ? `: ${body.slice(0, 280)}` : '';
  if (typeof body === 'object' && body !== null) {
    const o = body as Record<string, unknown>;
    const msg = o.message ?? o.error ?? o.msg;
    if (typeof msg === 'string' && msg.trim()) return `: ${msg.trim()}`;
  }
  try {
    const s = JSON.stringify(body);
    return s.length <= 280 ? `: ${s}` : `: ${s.slice(0, 280)}…`;
  } catch {
    return '';
  }
}

/** Mensagem amigável quando o relógio responde HTTP de erro (inclui trecho do corpo, ex. API do fabricante). */
export function formatRepDeviceFailureMessage(r: {
  ok: boolean;
  status: number;
  body: unknown;
  message?: string;
}): string {
  if (!r.ok && r.status === 0 && r.message) return r.message;
  if (r.ok) return 'Conexão OK';
  return `Resposta HTTP ${r.status}${summarizeRepDeviceBody(r.body)}`;
}

function responseImpliesPostExpected(r: { status: number; body: unknown }): boolean {
  if (r.status !== 400) return false;
  const fromObj = (x: unknown): string => {
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      return [o.message, o.error, o.detail, o.reason]
        .map((v) => (typeof v === 'string' ? v : ''))
        .join(' ');
    }
    return '';
  };
  const s = `${fromObj(r.body)} ${summarizeRepDeviceBody(r.body)}`.toLowerCase();
  return /post\s+expected|post\s+required|method\s+not\s+allowed/i.test(s) || s.includes('post expected');
}

/**
 * GET/POST no endpoint de status do relógio (mesma lógica do teste de conexão).
 */
export async function probeRepDeviceStatus(device: RepDevice): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
  message?: string;
}> {
  const statusPath = getRepStatusPath(device);
  const pref = getRepStatusMethodPref(device);
  const postBody = getRepStatusPostBody(device);

  let r: Awaited<ReturnType<typeof fetchRawDevicePath>>;
  if (pref === 'post') {
    r = await fetchRawDevicePath(device, statusPath, { method: 'POST', body: postBody });
  } else if (pref === 'get') {
    r = await fetchRawDevicePath(device, statusPath);
  } else {
    r = await fetchRawDevicePath(device, statusPath);
    if (!r.ok && responseImpliesPostExpected(r)) {
      r = await fetchRawDevicePath(device, statusPath, { method: 'POST', body: postBody });
    }
  }
  return r;
}

/**
 * Teste de conexão: adaptador do fabricante (ex. Control iD iDClass) ou GET/POST genérico em /api/status.
 */
export async function runRepConnectionTest(device: RepDevice): Promise<RepConnectionTestResult> {
  try {
    const adapter = getVendorAdapter(device);
    if (adapter?.testConnection) {
      return await adapter.testConnection(device);
    }
    const r = await probeRepDeviceStatus(device);
    if (r.message && !r.ok && r.status === 0) {
      return { ok: false, message: r.message, httpStatus: 0 };
    }
    if (r.ok) return { ok: true, message: 'Conexão OK', httpStatus: r.status, body: r.body };
    return {
      ok: false,
      message: formatRepDeviceFailureMessage(r),
      httpStatus: r.status,
      body: r.body,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `${msg}${device.ip ? cloudCannotReachLanHint(device.ip) : ''}`.trim(),
      httpStatus: 0,
    };
  }
}

export async function testConnectionServer(device: RepDevice): Promise<{ ok: boolean; message: string }> {
  const r = await runRepConnectionTest(device);
  return { ok: r.ok, message: r.message };
}

/**
 * Envia cadastro de funcionário ao relógio (só fabricantes com adaptador pushEmployee).
 */
export async function pushEmployeeToDeviceServer(
  device: RepDevice,
  employee: RepEmployeePayload
): Promise<{ ok: boolean; message: string }> {
  const hubKey = resolveTimeClockProviderKey(device);
  if (hubKey && hasTimeClockProvider(hubKey)) {
    try {
      const provider = getProvider(hubKey);
      const service = new TimeClockService(provider);
      const canonical = repEmployeePayloadToEmployeePayload(employee);
      const cfg = repDeviceToDeviceConfig(device, hubKey);
      const result = (await service.syncEmployee(cfg, canonical)) as { ok: boolean; message: string };
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: msg };
    }
  }

  const adapter = getVendorAdapter(device);
  if (adapter?.pushEmployee) {
    return adapter.pushEmployee(device, employee);
  }
  return {
    ok: false,
    message:
      'Envio de funcionário pelo sistema não está disponível para este fabricante. Cadastre no próprio relógio ou use a documentação do fabricante.',
  };
}

/**
 * Troca dados com o relógio (hora, info, lista de usuários) — conforme adaptador do fabricante.
 */
export async function runRepExchange(
  device: RepDevice,
  op: RepExchangeOp,
  clock?: RepDeviceClockSet
): Promise<{ ok: boolean; message?: string; data?: unknown; users?: RepUserFromDevice[] }> {
  try {
    const adapter = getVendorAdapter(device);
    const unsupported = {
      ok: false as const,
      message:
        'Esta operação não está disponível para o fabricante deste relógio (implementado para Control iD iDClass).',
    };
    if (!adapter) return unsupported;

    if (op === 'pull_clock' && adapter.pullClock) {
      return await adapter.pullClock(device);
    }
    if (op === 'push_clock' && adapter.pushClock) {
      if (!clock) {
        return { ok: false, message: 'Informe data e hora para gravar no relógio.' };
      }
      return await adapter.pushClock(device, clock);
    }
    if (op === 'pull_info' && adapter.pullDeviceInfo) {
      return await adapter.pullDeviceInfo(device);
    }
    if (op === 'pull_users' && adapter.pullUsersFromDevice) {
      return await adapter.pullUsersFromDevice(device);
    }
    return unsupported;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `${msg}${device.ip ? cloudCannotReachLanHint(device.ip) : ''}`.trim(),
    };
  }
}
