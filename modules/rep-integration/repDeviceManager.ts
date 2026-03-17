/**
 * Gerenciador de dispositivos REP - conexão por IP, arquivo ou API do fabricante
 */

import type { RepDevice, PunchFromDevice, RepVendorAdapter } from './types';

const CONNECT_TIMEOUT_MS = 10000;

/**
 * Tenta obter marcações de um relógio via HTTP (endpoint genérico)
 * GET ou POST em http://IP:porta/api/punches ou similar
 */
export async function fetchPunchesFromDevice(device: RepDevice, since?: Date): Promise<PunchFromDevice[]> {
  if (device.tipo_conexao !== 'rede' || !device.ip) {
    return [];
  }

  const port = device.porta || 80;
  const baseUrl = `http://${device.ip}:${port}`;
  const url = `${baseUrl}/api/punches${since ? `?since=${since.toISOString()}` : ''}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : (data.punches || data.records || []);
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/**
 * Registro de adaptadores por fabricante (Control iD, Henry, Topdata, etc.)
 */
const vendorAdapters: Map<string, RepVendorAdapter> = new Map();

export function registerVendorAdapter(fabricante: string, adapter: RepVendorAdapter): void {
  vendorAdapters.set(fabricante.toLowerCase(), adapter);
}

export function getVendorAdapter(device: RepDevice): RepVendorAdapter | null {
  if (!device.fabricante) return null;
  return vendorAdapters.get(device.fabricante.toLowerCase()) || null;
}

/**
 * Obtém marcações do dispositivo: primeiro tenta adaptador do fabricante, depois HTTP genérico
 */
export async function getPunchesFromDevice(device: RepDevice, since?: Date): Promise<PunchFromDevice[]> {
  const adapter = getVendorAdapter(device);
  if (adapter) {
    return adapter.fetchPunches(device, since);
  }
  if (device.tipo_conexao === 'rede') {
    return fetchPunchesFromDevice(device, since);
  }
  return [];
}

/**
 * Testa conectividade com o relógio (rede)
 */
export async function testConnection(device: RepDevice): Promise<{ ok: boolean; message: string }> {
  if (device.tipo_conexao !== 'rede' || !device.ip) {
    return { ok: false, message: 'Dispositivo não configurado para conexão por rede (IP/porta).' };
  }

  const port = device.porta || 80;
  const url = `http://${device.ip}:${port}/api/status`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) return { ok: true, message: 'Conexão OK' };
    return { ok: false, message: `Resposta HTTP ${res.status}` };
  } catch (e: unknown) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : 'Falha de conexão';
    return { ok: false, message: msg };
  }
}
