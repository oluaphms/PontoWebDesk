import type { RepDeviceClockSet } from '../../../../modules/rep-integration/types';
import type { EmployeeForRep, RepDeviceRow, RepRpcUserRow } from './types';
import { TIPOS_CONEXAO } from './constants';

/** Última atividade do agente em linguagem natural (pt-BR). */
export function formatRelativeTimePt(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 45) return 'há menos de 1 min';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return min <= 1 ? 'há 1 min' : `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? 'há 1 h' : `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

export function isEmployeeEligibleForRepPush(e: EmployeeForRep): boolean {
  if (e.invisivel) return false;
  if (e.demissao) return false;
  return (e.status || 'active').toLowerCase() === 'active';
}

export function parseRepRpcUserRow(data: unknown): RepRpcUserRow | null {
  if (data == null) return null;
  const o = typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!o) return null;
  const uid = o.user_id;
  const sid = typeof uid === 'string' ? uid : uid != null ? String(uid) : '';
  if (!sid) return null;
  const str = (v: unknown): string | null =>
    v == null ? null : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : String(v);
  return {
    user_id: sid,
    nome: str(o.nome),
    pis_pasep: str(o.pis_pasep),
    numero_identificador: str(o.numero_identificador),
    numero_folha: str(o.numero_folha),
  };
}

export function mergeEmployeeFromRepRpcRow(list: EmployeeForRep[], rpc: RepRpcUserRow): EmployeeForRep {
  const hit = list.find((u) => u.id === rpc.user_id);
  if (hit) return hit;
  return {
    id: rpc.user_id,
    nome: (rpc.nome || '').trim() || 'Colaborador',
    status: 'active',
    invisivel: false,
    demissao: null,
    pis_pasep: rpc.pis_pasep ?? null,
    pis: null,
    cpf: null,
    numero_identificador: rpc.numero_identificador ?? null,
    numero_folha: rpc.numero_folha ?? null,
  };
}

export function canonicalRepDeviceName(name: string | null | undefined): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\(agente local\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAgentLocalDevice(name: string | null | undefined): boolean {
  return /\(agente local\)/i.test(String(name || ''));
}

export function repConnectionCellText(d: RepDeviceRow): string {
  if (d.tipo_conexao === 'rede' && d.ip) return `${d.ip}:${d.porta ?? 80}`;
  return TIPOS_CONEXAO.find((t) => t.value === d.tipo_conexao)?.label ?? d.tipo_conexao;
}

export function readLsBool(key: string, defaultVal: boolean): boolean {
  if (typeof window === 'undefined') return defaultVal;
  let v: string | null = null;
  try {
    v = localStorage.getItem(key);
  } catch (err) {
    console.warn('[RepDevices] Falha ao ler storage:', err);
  }
  if (v === null) return defaultVal;
  return v === '1';
}

export async function withUiTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Tempo esgotado (${Math.round(timeoutMs / 1000)}s) em ${label}.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Fuso no formato Control iD Portaria 671 (ex.: -0300). */
export function formatTimezoneOffset671(d: Date): string {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}${mm}`;
}

export function buildLocalClockForRep(mode671: boolean): RepDeviceClockSet {
  const d = new Date();
  const clock: RepDeviceClockSet = {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
  };
  if (mode671) clock.timezone = formatTimezoneOffset671(d);
  return clock;
}

export function repMaskTailDigits(raw: string | null | undefined, tail: number): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 0) return '—';
  if (d.length <= tail) return `…${d}`;
  return `…${d.slice(-tail)}`;
}

/** RPC / trigger: folha já fechada para o mês do registo (`time_records_block_after_closure`). */
export function isTimesheetPeriodClosedError(msg: string | null | undefined): boolean {
  return Boolean(msg && /PERIODO_FECHADO/i.test(msg));
}
