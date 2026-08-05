import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Alinha relógio operacional ao servidor (Supabase) e expõe confiança temporal.
 */

import { isLocalApiDataProvider } from '../config/system';
import { getSupabaseClient } from './supabaseClient';
import {
  getOperationalWallClockOffsetMs,
  setOperationalWallClockOffsetMs,
} from '../utils/operationalDateHardLock';
import { apiGet } from './api';

const DRIFT_WARN_MS = 120_000;

let lastServerSyncOk = false;
/** Última tentativa de sync (sucesso ou falha). */
let lastServerSyncedAt = typeof Date !== 'undefined' ? Date.now() : 0;

export function wasOperationalServerClockSyncedRecently(withinMs: number = 120_000): boolean {
  return lastServerSyncOk && Date.now() - lastServerSyncedAt < withinMs;
}

/** Offset aplicado em `operationalClockMs()` após sync bem-sucedido. */
export async function syncServerOperationalClockOffset(): Promise<void> {
  const t0 = Date.now();
  let serverMs: number | null = null;
  try {
    if (isLocalApiDataProvider()) {
      const res = await apiGet<{ ok?: boolean; serverEpochMs?: number; dbEpochMs?: number }>('/health/time');
      serverMs = Number(res.dbEpochMs ?? res.serverEpochMs);
    } else {
      const client = getSupabaseClient();
      if (!client) return;
      const { data, error } = await client.rpc('operational_server_epoch_ms');
      if (error || data == null) {
        lastServerSyncOk = false;
        lastServerSyncedAt = Date.now();
        return;
      }
      serverMs = typeof data === 'bigint' ? Number(data) : typeof data === 'number' ? data : Number(data);
    }
  } catch {
    lastServerSyncOk = false;
    lastServerSyncedAt = Date.now();
    return;
  }
  const t1 = Date.now();
  lastServerSyncedAt = t1;
  if (!Number.isFinite(serverMs)) {
    lastServerSyncOk = false;
    return;
  }
  const rtt = t1 - t0;
  const clientMid = t0 + rtt / 2;
  const offset = Math.round(serverMs - clientMid);
  setOperationalWallClockOffsetMs(offset);
  lastServerSyncOk = true;
  lastServerSyncedAt = t1;
  if (Math.abs(offset) > DRIFT_WARN_MS) {
    observabilityConsole.warn('[CLOCK OFFSET DETECTED]', { offset_ms: offset, rtt_ms: rtt });
  }
}

/** Baixa confiança temporal: offset grande vs servidor ou sync repetidamente falho. */
export function isOperationalTemporalConfidenceLow(): boolean {
  if (Math.abs(getOperationalWallClockOffsetMs()) > DRIFT_WARN_MS) return true;
  if (!lastServerSyncOk && Date.now() - lastServerSyncedAt > 90_000) return true;
  return false;
}
