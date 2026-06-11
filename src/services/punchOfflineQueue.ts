/**
 * Fila offline de batidas web/mobile — IndexedDB + envio em lote (≥10).
 */
import type { RegisterPunchResult, RegisterPunchSecureParams } from '../rep/repEngine';
import { savePunchEvidence, type SavePunchEvidenceParams } from './punchEvidenceService';
import {
  ensurePunchOfflineDbReady,
  idbCountPending,
  idbDeletePunch,
  idbGetPunch,
  idbListPunchesByStatus,
  idbPutPunch,
  idbUpdatePunch,
} from './punchOfflineDb';
import {
  enqueueLocalSyncPunch,
  markLocalPunchSynced,
  putLocalPunch,
  removeLocalPunches,
  removeSyncQueueItems,
} from './localDb';
import { isCloudEnabled } from './cloudService';
import type { QueuedWebPunch } from './punchOfflineQueue.types';
import { getProvider } from './getProvider';

export type { QueuedWebPunch } from './punchOfflineQueue.types';

const MIN_BATCH = 10;
const MAX_BATCH = 25;

let lastFlushByClientId = new Map<string, RegisterPunchResult>();
const syncListeners = new Set<(detail: { flushed: number; clientIds: string[] }) => void>();

export function onWebPunchQueueSynced(
  listener: (detail: { flushed: number; clientIds: string[] }) => void,
): () => void {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

function emitSynced(detail: { flushed: number; clientIds: string[] }) {
  for (const fn of syncListeners) fn(detail);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('pontowebdesk:web-punch-synced', {
        detail,
      }),
    );
  }
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

async function rollbackQueuedPunch(id: string): Promise<void> {
  await Promise.all([
    idbDeletePunch(id),
    removeLocalPunches([id]),
    removeSyncQueueItems([id]),
  ]);
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
  const timestamp = String(params.timestamp || '').trim() || new Date(entry.createdAt).toISOString();
  const local = await putLocalPunch({
    id,
    timestamp,
    payload: params,
  });
  if (local) {
    await enqueueLocalSyncPunch({
      id,
      payload: { ...params, client_id: id, punch_hash: local.punch_hash },
    });
  }
  return entry;
}

/** Evita reenfileirar se já sincronizado (mesmo user+tipo+minuto). */
async function findSentByParamsFingerprint(params: RegisterPunchSecureParams): Promise<QueuedWebPunch | undefined> {
  const sent = await idbListPunchesByStatus('sent');
  const minuteKey = `${params.userId}|${params.companyId}|${params.type}|${new Date(params.timestamp || Date.now()).toISOString().slice(0, 16)}`;
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
  if (!isCloudEnabled()) {
    return { flushed: 0, degraded: true, retry_after: 60_000, clientIds: [] };
  }
  await ensurePunchOfflineDbReady();
  const pending = await idbListPunchesByStatus('pending');
  if (pending.length === 0) return { flushed: 0, clientIds: [] };
  if (!opts?.force && pending.length < MIN_BATCH) {
    return { flushed: 0, clientIds: [] };
  }

  const batch = pending
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, MAX_BATCH);

  const provider = getProvider();

  const data = (await provider.registerPunchBatch({
      punches: batch.map((b) => ({ client_id: b.id, ...b.params, _evidence: b.evidence ?? undefined })),
    })) as {
    ok?: boolean;
    degraded?: boolean;
    retry_after?: number;
    results?: Array<{ client_id?: string; success?: boolean; duplicate?: boolean; result?: RegisterPunchResult; error?: string }>;
  } | null;

  if (data?.degraded) {
    return { flushed: 0, degraded: true, retry_after: data.retry_after ?? 60_000, clientIds: [] };
  }

  if (!data?.ok) {
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
      await markLocalPunchSynced([item.id]);
      await removeSyncQueueItems([item.id]);
    } else if (r) {
      item.status = 'error';
      item.error = r.error;
      await idbUpdatePunch(item);
      await rollbackQueuedPunch(item.id);
    }
  }

  if (flushed > 0) emitSynced({ flushed, clientIds: syncedIds });
  return { flushed, clientIds: syncedIds };
}

function mapRegisterPunchResult(
  response: unknown,
  fallback: { clientId: string; timestamp: string },
): RegisterPunchResult & { pending?: boolean; clientId?: string } | null {
  const payload = (response ?? {}) as {
    ok?: boolean;
    result?: RegisterPunchResult & { id?: string; timestamp?: string; receipt_id?: string };
  };
  if (payload.ok !== true || !payload.result) return null;
  const result = payload.result as RegisterPunchResult & { time_record_id?: string | null };
  const id = String(result.time_record_id ?? result.id ?? fallback.clientId).trim();
  const timestamp = String(result.timestamp ?? fallback.timestamp).trim();
  return {
    id: id || fallback.clientId,
    nsr: Number(result.nsr ?? 0),
    hash: String(result.hash ?? `sync-${fallback.clientId}`),
    previous_hash: String(result.previous_hash ?? '0'),
    timestamp: timestamp || fallback.timestamp,
    receipt_id: String(result.receipt_id ?? result.id ?? fallback.clientId),
    pending: false,
    clientId: fallback.clientId,
  };
}

async function trySyncSingleWebPunch(
  entry: QueuedWebPunch,
): Promise<(RegisterPunchResult & { pending?: boolean; clientId?: string }) | null> {
  if (!isCloudEnabled()) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

  const provider = getProvider();

  const response = await provider.registerPunch({
    client_id: entry.id,
    ...entry.params,
    _evidence: entry.evidence ?? undefined,
  });
  const mapped = mapRegisterPunchResult(response, {
    clientId: entry.id,
    timestamp: new Date(entry.createdAt).toISOString(),
  });
  if (!mapped) return null;

  entry.status = 'sent';
  await idbUpdatePunch(entry);
  await markLocalPunchSynced([entry.id]);
  await removeSyncQueueItems([entry.id]);
  if (entry.evidence) {
    try {
      await savePunchEvidence({ ...entry.evidence, timeRecordId: mapped.id });
    } catch {
      /* best-effort */
    }
  }
  emitSynced({ flushed: 1, clientIds: [entry.id] });
  return mapped;
}

export async function enqueueAndMaybeSyncWebPunch(
  params: RegisterPunchSecureParams,
  evidence?: Omit<SavePunchEvidenceParams, 'timeRecordId'> | null,
): Promise<RegisterPunchResult & { pending?: boolean; clientId?: string }> {
  const entry = await savePunchLocal(params, evidence);
  let singleSync: (RegisterPunchResult & { pending?: boolean; clientId?: string }) | null = null;
  try {
    singleSync = await trySyncSingleWebPunch(entry);
  } catch (error) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return optimisticResult(entry);
    }
    await rollbackQueuedPunch(entry.id);
    throw error;
  }
  if (singleSync) {
    return singleSync;
  }
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
