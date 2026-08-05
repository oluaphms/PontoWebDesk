/**
 * Adaptador Control iD - integração nativa com relógios Control iD
 * Interface REPAdapter: connect, fetchPunches, getDeviceStatus
 */

import type { REPAdapter, RepDeviceConfig, PunchFromDevice, DeviceStatusResult } from '../types';

const CONNECT_TIMEOUT_MS = 10000;

function normalizeTipo(t: string): string {
  const u = (t || 'E').toString().toUpperCase();
  if (u.startsWith('E') || u === 'IN' || u === '1') return 'E';
  if (u.startsWith('S') || u === 'OUT' || u === '2') return 'S';
  if (u.startsWith('P') || u === 'BREAK' || u === '3') return 'P';
  return u.slice(0, 1);
}

function buildBaseUrl(device: RepDeviceConfig): string {
  const port = device.porta || 8080;
  return `http://${device.ip}:${port}`;
}

const controlidAdapter: REPAdapter = {
  name: 'Control iD',
  vendor: 'controlid',

  async connect(device: RepDeviceConfig): Promise<boolean> {
    if (!device.ip || device.tipo_conexao !== 'rede') return false;
    const url = `${buildBaseUrl(device)}/api/v1/status`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      const opts: RequestInit = { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } };
      if (device.usuario && device.senha) {
        opts.headers = { ...opts.headers, Authorization: `Basic ${btoa(`${device.usuario}:${device.senha}`)}` };
      }
      const res = await fetch(url, opts);
      clearTimeout(timeout);
      return res.ok;
    } catch {
      clearTimeout(timeout);
      return false;
    }
  },

  async fetchPunches(device: RepDeviceConfig, lastNSR?: number): Promise<PunchFromDevice[]> {
    if (!device.ip) return [];
    const baseUrl = buildBaseUrl(device);
    const url = lastNSR != null
      ? `${baseUrl}/api/v1/punches?lastNSR=${lastNSR}`
      : `${baseUrl}/api/v1/punches`;
    const opts: RequestInit = { headers: { Accept: 'application/json' } };
    if (device.usuario && device.senha) {
      (opts as RequestInit).headers = { ...(opts.headers as Record<string, string>), Authorization: `Basic ${btoa(`${device.usuario}:${device.senha}`)}` };
    }
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`Control iD API: ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || data.punches || []);
    return list.map((p: Record<string, unknown>) => ({
      pis: (p.pis ?? p.pisPasep ?? p.employeeId) as string | undefined,
      cpf: p.cpf as string | undefined,
      matricula: (p.matricula ?? p.badge ?? p.numero_folha) as string | undefined,
      nome: (p.nome ?? p.name) as string | undefined,
      data_hora: (p.timestamp ?? p.data_hora ?? p.datetime) as string,
      tipo: normalizeTipo((p.tipo ?? p.type ?? p.event) as string),
      nsr: (p.nsr ?? p.nsr) as number | undefined,
      raw: p as Record<string, unknown>,
    }));
  },

  async getDeviceStatus(device: RepDeviceConfig): Promise<DeviceStatusResult> {
    if (!device.ip) return { ok: false, message: 'IP não configurado' };
    const url = `${buildBaseUrl(device)}/api/v1/status`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const opts: RequestInit = { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } };
      if (device.usuario && device.senha) {
        (opts as RequestInit).headers = { ...(opts.headers as Record<string, string>), Authorization: `Basic ${btoa(`${device.usuario}:${device.senha}`)}` };
      }
      const res = await fetch(url, opts);
      clearTimeout(timeout);
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
      const data = await res.json().catch(() => ({}));
      return {
        ok: true,
        message: 'Conectado',
        lastNsr: data.lastNSR ?? data.last_nsr,
        battery: data.battery,
        firmware: data.firmware ?? data.version,
      };
    } catch (e) {
      clearTimeout(timeout);
      return { ok: false, message: e instanceof Error ? e.message : 'Falha de conexão' };
    }
  },
};

export default controlidAdapter;
