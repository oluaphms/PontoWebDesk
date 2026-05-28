/**
 * Dimep — leitura via AFD (arquivo ou conteúdo mock em extra).
 */

import * as fs from 'node:fs';
import type { ClockAdapter, DeviceConfig, NormalizedRecord } from './types';
import { safeResolveAfdFile } from '../../agent/utils/safeResolvePath.js';
import { normalizeAfdTextToRecords } from './dimep/afd-parser';

const DEFAULT_TZ = 'America/Sao_Paulo';

function filterSince(records: NormalizedRecord[], lastSync?: string): NormalizedRecord[] {
  if (!lastSync) return records;
  const t0 = new Date(lastSync).getTime();
  if (Number.isNaN(t0)) return records;
  return records.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    return !Number.isNaN(t) && t > t0;
  });
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

/** AFD mínimo para desenvolvimento quando não há arquivo (NSR+tipo 3/7+DDMMAAAA+HHMMSS+PIS). */
function defaultMockAfd(): string {
  const now = new Date();
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getUTCFullYear());
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const data = `${dd}${mm}${yyyy}`;
  const hora = `${hh}${mi}${ss}`;
  return `0000000013${data}${hora}12345678901E`;
}

export const dimepAdapter: ClockAdapter = {
  async fetch(device: DeviceConfig, lastSync?: string): Promise<NormalizedRecord[]> {
    const tz =
      typeof device.extra?.afd_timezone === 'string' && device.extra.afd_timezone.trim()
        ? device.extra.afd_timezone.trim()
        : DEFAULT_TZ;
    let text = readAfdContent(device);
    if (!text) {
      text = defaultMockAfd();
    }
    const records = normalizeAfdTextToRecords(device, text, tz);
    return filterSince(records, lastSync);
  },
};
