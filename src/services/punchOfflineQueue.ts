/**
 * Fila offline de batidas web/mobile — IndexedDB + envio em lote (≥10).
 */
import type { RegisterPunchResult, RegisterPunchSecureParams } from '../rep/repEngine';
import { savePunchEvidence, type SavePunchEvidenceParams } from './punchEvidenceService';
import { supabase } from './supabaseClient';
import {
  ensurePunchOfflineDbReady,
  idbCountPending,
  idbGetPunch,
  idbListPunchesByStatus,
  idbPutPunch,
  idbUpdatePunch,
} from './punchOfflineDb';
import type { QueuedWebPunch } from './punchOfflineQueue.types';

export type { QueuedWebPunch } from './punchOfflineQueue.types';

const MIN_BATCH = 10;
const MAX_BATCH = 25;

let lastFlushByClientId = new Map<string, RegisterPunchResult>();
let syncListeners = new Set<(detail: { flushed: number; clientIds: string[] }) => void>();

export function onWebPunchQueueSynced(
  listener: (detail: { flushed: number; clientIds: string[] }) => void,
): () => void {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

function emitSynced(detail: { flushed: number; clientIds: string[] }) {
  for (const fn of syncListeners) fn(detail);
}

function newClientId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `pq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function optimisticResult(entry: QueuedWebPunch): RegisterPunchResult & { pending?: boolean; clientId?: string } {
  return {
    id: entry.id,
    nsr: 0,
    hash: `pending-${entry.id.slice(0, 12)}`,
    previous_hash: '0',
    timestamp: new Date().toISOString(),
    receipt_id: entry.id,
    pending: true,
    clientId: entry.id,
  };
}

export async function countPendingWebPunches(): Promise<number> {
  await ensurePunchOfflineDbReady();
  return idbCountPending();
}

export async function savePunchLocal(
  params: RegisterPunchSecureParams,
  evidence?: Omit<SavePunchEvidenceParams, 'timeRecordId'> | null,
): Promise<QueuedWebPunch> {
  await ensurePunchOfflineDbReady();
  const existingSent = await findSentByParamsFingerprint(params);
  if (existingSent) {
    return { ...existingSent, status: 'sent' };
  }

  const id = newClientId();
  const entry: QueuedWebPunch = {
    id,
    params,
    evidence: evidence ?? null,
    createdAt: Date.now(),
    status: 'pending',
  };
  await idbPutPunch(entry);
  return entry;
}

/** Evita reenfileirar se já sincronizado (mesmo user+tipo+minuto). */
async function findSentByParamsFingerprint(params: RegisterPunchSecureParams): Promise<QueuedWebPunch | undefined> {
  const sent = await idbListPunchesByStatus('sent');
  const minuteKey = `${params.userId}|${params.companyId}|${params.type}|${new Date().toISOString().slice(0, 16)}`;
  return sent.find((s) => {
    const k = `${s.params.userId}|${s.params.companyId}|${s.params.type}|${new Date(s.createdAt).toISOString().slice(0, 16)}`;
    return k === minuteKey;
  });
}

export async function flushWebPunchQueue(opts?: { force?: boolean }): Promise<{
  flushed: number;
  degraded?: boolean;
  retry_after?: number;
  clientIds?: string[];
}> {
  await ensurePunchOfflineDbReady();
  const pending = await idbListPunchesByStatus('pending');
  if (pending.length === 0) return { flushed: 0, clientIds: [] };
  if (!opts?.force && pending.length < MIN_BATCH) {
    return { flushed: 0, clientIds: [] };
  }

  const batch = pending
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, MAX_BATCH);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { flushed: 0, clientIds: [] };
  }

  const res = await fetch('/api/web-punches', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      punches: batch.map((b) => ({ client_id: b.id, ...b.params, _evidence: b.evidence ?? undefined })),
    }),
  });

  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    degraded?: boolean;
    retry_after?: number;
    results?: Array<{ client_id?: string; success?: boolean; duplicate?: boolean; result?: RegisterPunchResult; error?: string }>;
  } | null;

  if (data?.degraded) {
    return { flushed: 0, degraded: true, retry_after: data.retry_after ?? 60_000, clientIds: [] };
  }

  if (!res.ok || !data?.ok) {
    return { flushed: 0, clientIds: [] };
  }

  const byClient = new Map((data.results ?? []).map((r) => [String(r.client_id || ''), r]));
  lastFlushByClientId = new Map();
  let flushed = 0;
  const syncedIds: string[] = [];

  for (const item of batch) {
    const r = byClient.get(item.id);
    const ok = r?.success === true || r?.duplicate === true;
    if (ok) {
      item.status = 'sent';
      flushed += 1;
      syncedIds.push(item.id);
      if (r?.result) lastFlushByClientId.set(item.id, r.result as RegisterPunchResult);
      const recordId = String((r?.result as RegisterPunchResult)?.id || '').trim();
      if (recordId && item.evidence) {
        try {
          await savePunchEvidence({ ...item.evidence, timeRecordId: recordId });
        } catch {
          /* best-effort */
        }
      }
      await idbUpdatePunch(item);
    } else if (r) {
      item.status = 'error';
      item.error = r.error;
      await idbUpdatePunch(item);
    }
  }

  if (flushed > 0) emitSynced({ flushed, clientIds: syncedIds });
  return { flushed, clientIds: syncedIds };
}

export async function enqueueAndMaybeSyncWebPunch(
  params: RegisterPunchSecureParams,
  evidence?: Omit<SavePunchEvidenceParams, 'timeRecordId'> | null,
): Promise<RegisterPunchResult & { pending?: boolean; clientId?: string }> {
  const entry = await savePunchLocal(params, evidence);
  const pending = await countPendingWebPunches();
  if (pending >= MIN_BATCH) {
    const flush = await flushWebPunchQueue({ force: true });
    if (!flush.degraded) {
      const fromFlush = lastFlushByClientId.get(entry.id);
      if (fromFlush) return { ...fromFlush, pending: false, clientId: entry.id };
      const refreshed = await idbGetPunch(entry.id);
      if (refreshed?.status === 'sent') {
        return {
          id: entry.id,
          nsr: 0,
          hash: entry.id,
          previous_hash: '0',
          timestamp: new Date(entry.createdAt).toISOString(),
          receipt_id: entry.id,
          pending: false,
          clientId: entry.id,
        };
      }
    }
  }
  return optimisticResult(entry);
}
