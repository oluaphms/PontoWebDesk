/**
 * Control iD — HTTP com autenticação básica em /load_objects quando disponível;
 * fallback para fluxo iDClass (login.fcgi + get_afd) já validado no projeto.
 */

import type { RepDevice } from '../../modules/rep-integration/types';
import { deviceFetch, buildDeviceOrigin } from '../../modules/rep-integration/repDeviceHttp';
import ControlIdVendorAdapter from '../../modules/rep-integration/adapters/controlId';
import type { PunchFromDevice } from '../../modules/rep-integration/types';
import type { ClockAdapter, DeviceConfig, NormalizedRecord } from './types';

function toRepDevice(device: DeviceConfig): RepDevice {
  const ex = { ...(device.extra || {}) };
  if (device.username != null) {
    ex.rep_login = device.username;
    ex.login = device.username;
  }
  if (device.password != null) {
    ex.rep_password = device.password;
    ex.password = device.password;
  }
  return {
    id: device.id,
    company_id: device.company_id,
    nome_dispositivo: device.id,
    provider_type: 'control_id',
    fabricante: 'Control iD',
    ip: device.ip,
    porta: device.port ?? null,
    tipo_conexao: 'rede',
    ativo: true,
    config_extra: ex,
  };
}

function mapTipoToEventType(t: string): string {
  const u = (t || 'E').toString().toUpperCase();
  if (u.startsWith('E') || u === 'IN' || u === '1') return 'entrada';
  if (u.startsWith('S') || u === 'OUT' || u === '2') return 'saida';
  if (u.startsWith('P') || u === 'BREAK' || u === '3') return 'pausa';
  return 'batida';
}

function punchToNormalized(device: DeviceConfig, p: PunchFromDevice): NormalizedRecord {
  const employee_id = String(p.pis || p.cpf || p.matricula || 'unknown');
  return {
    employee_id,
    timestamp: p.data_hora,
    event_type: mapTipoToEventType(p.tipo),
    device_id: device.id,
    company_id: device.company_id,
    raw: {
      ...(p.raw && typeof p.raw === 'object' ? p.raw : {}),
      nsr: p.nsr,
      tipo_origem: p.tipo,
      source: 'controlid_fcgi',
    },
  };
}

/** Extrai lista de objetos de marcação de respostas JSON heterogêneas do firmware. */
function extractEventLikeRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object');
  }
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const keys = ['objects', 'records', 'logs', 'events', 'data', 'transactions', 'access_logs', 'marcacoes'];
    for (const k of keys) {
      const v = o[k];
      if (Array.isArray(v)) {
        return v.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object');
      }
    }
  }
  return [];
}

function pickIsoTimestamp(row: Record<string, unknown>): string | null {
  const candidates = [
    row.timestamp,
    row.time,
    row.datetime,
    row.data_hora,
    row.date_time,
    row.event_time,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 8) {
      const d = new Date(c);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    if (typeof c === 'number' && Number.isFinite(c)) {
      return new Date(c).toISOString();
    }
  }
  return null;
}

function pickEmployeeId(row: Record<string, unknown>): string {
  const keys = ['employee_id', 'user_id', 'pis', 'cpf', 'badge', 'matricula', 'pin', 'enrollment'];
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).replace(/\D/g, '').slice(0, 14) || String(v);
  }
  return 'unknown';
}

function pickTipo(row: Record<string, unknown>): string {
  const v = row.tipo ?? row.type ?? row.event ?? row.direction ?? row.mode;
  return typeof v === 'string' ? v : 'E';
}

function rowToNormalized(device: DeviceConfig, row: Record<string, unknown>): NormalizedRecord | null {
  const ts = pickIsoTimestamp(row);
  if (!ts) return null;
  return {
    employee_id: pickEmployeeId(row),
    timestamp: ts,
    event_type: mapTipoToEventType(pickTipo(row)),
    device_id: device.id,
    company_id: device.company_id,
    raw: { ...row, source: 'controlid_load_objects' },
  };
}

async function fetchViaLoadObjects(device: DeviceConfig, rep: RepDevice): Promise<NormalizedRecord[]> {
  const user = device.username ?? 'admin';
  const pass = device.password ?? 'admin';
  const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  const bodyTemplate =
    typeof device.extra?.load_objects_body === 'object' && device.extra?.load_objects_body !== null
      ? (device.extra.load_objects_body as Record<string, unknown>)
      : { object: 'access_logs' };

  const paths = ['/load_objects', '/load_objects.fcgi', '/api/load_objects'];
  for (const path of paths) {
    try {
      const res = await deviceFetch(rep, path, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Basic ${token}`,
        },
        body: JSON.stringify(bodyTemplate),
      });
      if (!res.ok) continue;
      const text = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }
      const rows = extractEventLikeRows(data);
      const out: NormalizedRecord[] = [];
      for (const row of rows) {
        const n = rowToNormalized(device, row);
        if (n) out.push(n);
      }
      if (out.length > 0) return out;
    } catch {
      /* tenta próximo path */
    }
  }
  return [];
}

function filterSince(records: NormalizedRecord[], lastSync?: string): NormalizedRecord[] {
  if (!lastSync) return records;
  const t0 = new Date(lastSync).getTime();
  if (Number.isNaN(t0)) return records;
  return records.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    return !Number.isNaN(t) && t > t0;
  });
}

export const controlIdAdapter: ClockAdapter = {
  async fetch(device: DeviceConfig, lastSync?: string): Promise<NormalizedRecord[]> {
    const rep = toRepDevice(device);
    const preferFcgiOnly = device.extra?.controlid_use_fcgi_only === true;

    if (!preferFcgiOnly) {
      const fromLoad = await fetchViaLoadObjects(device, rep);
      const filteredLoad = filterSince(fromLoad, lastSync);
      if (filteredLoad.length > 0) return filteredLoad;
    }

    const since = lastSync ? new Date(lastSync) : undefined;
    const punches = await ControlIdVendorAdapter.fetchPunches(rep, since);
    const normalized = punches.map((p) => punchToNormalized(device, p));
    return filterSince(normalized, lastSync);
  },
};

export function controlIdAdapterBuildBaseUrl(device: DeviceConfig): string {
  return buildDeviceOrigin(toRepDevice(device));
}
