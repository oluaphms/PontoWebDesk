/**
 * Adaptador Henry Equipamentos Eletrônicos e Sistemas
 * Interface REPAdapter: connect, fetchPunches, getDeviceStatus
 */

import type { REPAdapter, RepDeviceConfig, PunchFromDevice, DeviceStatusResult } from '../types';

const CONNECT_TIMEOUT_MS = 10000;

function normalizeTipo(t: string): string {
  const u = (t || 'E').toString().toUpperCase();
  if (u.startsWith('E') || u === '1' || u === 'I') return 'E';
  if (u.startsWith('S') || u === '2' || u === 'O') return 'S';
  if (u.startsWith('P') || u === '3') return 'P';
  return u.slice(0, 1);
}

function buildBaseUrl(device: RepDeviceConfig): string {
  const port = device.porta || 80;
  return `http://${device.ip}:${port}`;
}

const henryAdapter: REPAdapter = {
  name: 'Henry Equipamentos',
  vendor: 'henry',

  async connect(device: RepDeviceConfig): Promise<boolean> {
    if (!device.ip || device.tipo_conexao !== 'rede') return false;
    const url = `${buildBaseUrl(device)}/status`;
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
      ? `${baseUrl}/afd/punches?nsr=${lastNSR}`
      : `${baseUrl}/afd/punches`;
    const opts: RequestInit = { headers: { Accept: 'application/json' } };
    if (device.usuario && device.senha) {
      (opts as RequestInit).headers = { ...(opts.headers as Record<string, string>), Authorization: `Basic ${btoa(`${device.usuario}:${device.senha}`)}` };
    }
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`Henry API: ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.registros ?? data.punches ?? data.data ?? []);
    return list.map((p: Record<string, unknown>) => {
      const dt = p.data ?? p.date ?? p.data_hora ?? p.timestamp;
      const iso = typeof dt === 'string' ? dt : (dt && typeof (dt as { toISOString?: () => string }).toISOString === 'function' ? (dt as { toISOString: () => string }).toISOString() : new Date().toISOString());
      return {
        pis: (p.pis ?? p.cpf ?? p.identificador) as string | undefined,
        cpf: p.cpf as string | undefined,
        matricula: (p.matricula ?? p.cartao ?? p.numero_folha) as string | undefined,
        nome: (p.nome ?? p.name) as string | undefined,
        data_hora: iso,
        tipo: normalizeTipo((p.tipo ?? p.type ?? p.marcacao ?? p.evento) as string),
        nsr: (p.nsr ?? p.nsr_sequencial) as number | undefined,
        raw: p as Record<string, unknown>,
      };
    });
  },

  async getDeviceStatus(device: RepDeviceConfig): Promise<DeviceStatusResult> {
    if (!device.ip) return { ok: false, message: 'IP não configurado' };
    const url = `${buildBaseUrl(device)}/status`;
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
        lastNsr: data.ultimo_nsr ?? data.lastNSR,
        firmware: data.versao ?? data.firmware,
      };
    } catch (e) {
      clearTimeout(timeout);
      return { ok: false, message: e instanceof Error ? e.message : 'Falha de conexão' };
    }
  },
};

export default henryAdapter;
