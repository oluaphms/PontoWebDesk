/**
 * Gerenciador de dispositivos REP - conexão por fabricante (adapters) ou HTTP genérico
 */

import type { RepDeviceConfig, PunchFromDevice } from './types';
import { getREPAdapter } from './repAdapters';

const CONNECT_TIMEOUT_MS = 10000;

/**
 * Conecta ao dispositivo (via adaptador ou HTTP genérico)
 */
export async function connect(device: RepDeviceConfig): Promise<boolean> {
  const adapter = getREPAdapter(device);
  if (adapter) return adapter.connect(device);
  if (device.tipo_conexao === 'rede' && device.ip) {
    const port = device.porta || 80;
    const url = `http://${device.ip}:${port}/api/status`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      clearTimeout(timeout);
      return false;
    }
  }
  return false;
}

/**
 * Obtém marcações do dispositivo: adaptador do fabricante ou HTTP genérico
 */
export async function fetchPunches(
  device: RepDeviceConfig,
  lastNSR?: number
): Promise<PunchFromDevice[]> {
  const adapter = getREPAdapter(device);
  if (adapter) return adapter.fetchPunches(device, lastNSR);
  if (device.tipo_conexao === 'rede' && device.ip) {
    const port = device.porta || 80;
    const baseUrl = `http://${device.ip}:${port}`;
    const url = lastNSR != null
      ? `${baseUrl}/api/punches?lastNSR=${lastNSR}`
      : `${baseUrl}/api/punches`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : (data.punches || data.records || []);
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }
  return [];
}

/**
 * Retorna status do relógio (adaptador ou genérico)
 */
export async function getDeviceStatus(device: RepDeviceConfig): Promise<{ ok: boolean; message: string }> {
  const adapter = getREPAdapter(device);
  if (adapter) {
    const result = await adapter.getDeviceStatus(device);
    return { ok: result.ok, message: result.message };
  }
  if (device.tipo_conexao !== 'rede' || !device.ip) {
    return { ok: false, message: 'Dispositivo não configurado para rede (IP/porta).' };
  }
  const port = device.porta || 80;
  const url = `http://${device.ip}:${port}/api/status`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    return res.ok ? { ok: true, message: 'Conexão OK' } : { ok: false, message: `HTTP ${res.status}` };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, message: e instanceof Error ? e.message : 'Falha de conexão' };
  }
}
