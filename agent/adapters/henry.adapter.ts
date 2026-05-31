import { observabilityConsole } from '../../src/shared/logger/observabilityConsole';
/**
 * Adapter Henry — implementação para comunicação com relógios Henry.
 * 
 * Protocolos suportados:
 * - Henry Access (TCP/IP)
 * - Henry AFD (arquivo texto)
 * - API HTTP (novos modelos)
 * 
 * Por enquanto implementa AFD e mock para desenvolvimento.
 */

import * as fs from 'node:fs';
import type { ClockAdapter, DeviceConfig, Punch } from './types';
import { safeResolveAfdFile } from '../utils/safeResolvePath.js';

const DEFAULT_TZ = 'America/Sao_Paulo';

/**
 * Parse de linha AFD Henry (similar ao Dimep, mas com possíveis variações)
 */
function parseHenryAfdLine(line: string, device: DeviceConfig, tz: string): Punch | null {
  const clean = line.trim();
  if (clean.length < 38) return null;

  // Tipo 3 = marcação de ponto
  const tipo = clean.charAt(9);
  if (tipo !== '3') return null;

  const nsr = parseInt(clean.substring(0, 9), 10);
  const data = clean.substring(10, 18); // DDMMAAAA
  const hora = clean.substring(18, 24); // HHMMSS
  const pis = clean.substring(24, 36); // 12 dígitos

  const dia = parseInt(data.substring(0, 2), 10);
  const mes = parseInt(data.substring(2, 4), 10);
  const ano = parseInt(data.substring(4, 8), 10);

  if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || ano < 2000) return null;

  const hh = parseInt(hora.substring(0, 2), 10);
  const mm = parseInt(hora.substring(2, 4), 10);
  const ss = parseInt(hora.substring(4, 6), 10);

  if (hh > 23 || mm > 59 || ss > 59) return null;

  const isoString = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  const date = new Date(isoString);

  if (Number.isNaN(date.getTime())) return null;

  // O arquivo AFD da Portaria 1510 não contém indicador de tipo (entrada/saída)
  // O tipo será determinado pelo backend baseado na escala/horário do funcionário
  const eventType: Punch['event_type'] = 'batida';

  return {
    employee_id: pis.replace(/\D/g, '').slice(0, 11) || pis,
    timestamp: date.toISOString(),
    event_type: eventType,
    device_id: device.id,
    company_id: device.company_id,
    nsr,
    raw: {
      nsr,
      tipo_registro: tipo,
      data_afd: data,
      hora_afd: hora,
      pis,
      timezone: tz,
      source: 'henry_afd',
      brand: 'Henry',
    },
  };
}

function parseHenryAfdContent(device: DeviceConfig, content: string, tz: string): Punch[] {
  const lines = content.split(/\r?\n/);
  const punches: Punch[] = [];

  for (const line of lines) {
    const punch = parseHenryAfdLine(line, device, tz);
    if (punch) punches.push(punch);
  }

  return punches;
}

function readAfdContent(device: DeviceConfig): string | null {
  const ex = device.extra || {};
  
  if (typeof ex.afd_text === 'string' && ex.afd_text.trim()) {
    return ex.afd_text;
  }
  
  if (typeof ex.afd_mock === 'string' && ex.afd_mock.trim()) {
    return ex.afd_mock;
  }
  
  const filePath = typeof ex.afd_file === 'string' ? ex.afd_file.trim() : '';
  if (filePath) {
    const resolved = safeResolveAfdFile(filePath);
    if (resolved && fs.existsSync(resolved)) {
      return fs.readFileSync(resolved, 'utf8');
    }
  }
  
  return null;
}

/** Mock para desenvolvimento */
function defaultMockAfd(device: DeviceConfig): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const data = `${dd}${mm}${yyyy}`;
  const hora = `${hh}${mi}${ss}`;
  
  // Henry: E = Entrada
  return `0000000013${data}${hora}12345678901E`;
}

function filterSince(records: Punch[], lastSync?: string): Punch[] {
  if (!lastSync) return records;
  const t0 = new Date(lastSync).getTime();
  if (Number.isNaN(t0)) return records;
  return records.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    return !Number.isNaN(t) && t > t0;
  });
}

function generateDedupeHash(punch: Punch): string {
  const base = `${punch.company_id}|${punch.device_id}|${punch.employee_id}|${punch.timestamp}|${punch.event_type}`;
  return require('crypto').createHash('sha256').update(base, 'utf8').digest('hex');
}

/**
 * TODO: Implementar comunicação TCP/IP direta com Henry Access
 * quando especificação do protocolo estiver disponível.
 */
async function fetchViaTcp(device: DeviceConfig): Promise<Punch[]> {
  // Placeholder para futura implementação TCP
  observabilityConsole.log(`[Henry] TCP fetch não implementado para ${device.ip}:${device.port || 4370}`);
  return [];
}

/**
 * TODO: Implementar API HTTP para modelos novos
 */
async function fetchViaHttp(device: DeviceConfig): Promise<Punch[]> {
  // Placeholder para futura implementação HTTP
  observabilityConsole.log(`[Henry] HTTP API não implementada para ${device.ip}`);
  return [];
}

export const henryAdapter: ClockAdapter = {
  async getPunches(device: DeviceConfig, lastSync?: string): Promise<Punch[]> {
    const tz =
      typeof device.extra?.timezone === 'string' && device.extra.timezone.trim()
        ? device.extra.timezone.trim()
        : DEFAULT_TZ;

    let punches: Punch[] = [];

    // Tentar AFD primeiro
    const afdText = readAfdContent(device);
    if (afdText) {
      punches = parseHenryAfdContent(device, afdText, tz);
    } else {
      // Tentar TCP (quando implementado)
      const tcpPunches = await fetchViaTcp(device);
      if (tcpPunches.length > 0) {
        punches = tcpPunches;
      } else {
        // Mock para desenvolvimento
        const mockText = defaultMockAfd(device);
        punches = parseHenryAfdContent(device, mockText, tz);
      }
    }

    // Adicionar dedupe_hash
    for (const punch of punches) {
      if (!punch.dedupe_hash) {
        punch.dedupe_hash = generateDedupeHash(punch);
      }
    }

    return filterSince(punches, lastSync);
  },
};
