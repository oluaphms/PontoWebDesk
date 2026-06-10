import { observabilityConsole } from '../services/observabilityConsole.js';
/**
 * Fila local → envio em lote POST /api/rep/punches (anti-egress).
 */
import { getAgentDb } from './rep-agent-db.mjs';
import { computeRepPunchHash } from './rep-punch-hash.mjs';
import { agentLog } from './rep-agent-structured-log.mjs';

const REP_LOW_COST_MODE = /^(1|true|yes)$/i.test((process.env.REP_LOW_COST_MODE || '').trim());
const REP_ULTRA_LOW_COST = /^(1|true|yes)$/i.test((process.env.REP_ULTRA_LOW_COST || '').trim());

const BATCH_SIZE = Math.max(1, Math.min(50, parseInt(process.env.REP_BATCH_SIZE || '50', 10) || 50));
/** Mínimo para enviar sem force — evita request com 1–9 registros. */
const MIN_SEND_BATCH = Math.max(
  1,
  Math.min(
    BATCH_SIZE,
    parseInt(
      process.env.REP_MIN_SEND_BATCH ||
        (REP_ULTRA_LOW_COST ? String(BATCH_SIZE) : '1'),
      10,
    ) || (REP_ULTRA_LOW_COST ? BATCH_SIZE : 1),
  ),
);
const REP_BATCH_SYNC_MIN_MS = Math.max(
  15_000,
  parseInt(
    process.env.REP_BATCH_SYNC_INTERVAL_MS || (REP_LOW_COST_MODE ? '120000' : '30000'),
    10,
  ) || (REP_LOW_COST_MODE ? 120_000 : 30_000),
);
const REP_BATCH_SYNC_MAX_MS = Math.max(
  REP_BATCH_SYNC_MIN_MS,
  parseInt(process.env.REP_BATCH_SYNC_MAX_MS || '300000', 10) || 300_000,
);
const REP_BATCH_TIMEOUT_MS = Math.max(
  10_000,
  parseInt(process.env.REP_BATCH_TIMEOUT_MS || '45000', 10) || 45_000,
);

let syncTimer = null;
let syncBusy = false;
let syncDelayMs = REP_BATCH_SYNC_MIN_MS;
let queueConfig = null;

export function initPunchQueue(config) {
  queueConfig = config;
  getAgentDb();
}

export function punchQueueId(body) {
  const hash =
    (typeof body?.punch_hash === 'string' && body.punch_hash.trim()) ||
    (typeof body?.hash === 'string' && body.hash.trim()) ||
    computeRepPunchHash({
      deviceId: body?.device_id || '',
      pis: body?.pis ?? body?.cpf,
      data_hora: body?.data_hora,
      nsr: body?.nsr,
    });
  return hash;
}

/**
 * Persiste batida localmente. Nunca chama a API.
 * @returns {{ id: string, queued: boolean, duplicate: boolean, alreadyPending: boolean }}
 */
export function savePunchLocal(body) {
  const db = getAgentDb();
  const id = punchQueueId(body);
  const payload = JSON.stringify({ ...body, punch_hash: id, hash: id });
  const existing = db.prepare('SELECT status FROM punches WHERE id = ?').get(id);
  if (existing?.status === 'sent') {
    return { id, queued: false, duplicate: true, alreadyPending: false };
  }
  if (existing?.status === 'pending') {
    return { id, queued: false, duplicate: false, alreadyPending: true };
  }
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO punches (id, payload, status, created_at)
       VALUES (?, ?, 'pending', ?)`,
    )
    .run(id, payload, Date.now());
  const inserted = Number(info.changes) > 0;
  return {
    id,
    queued: inserted,
    duplicate: false,
    alreadyPending: !inserted && Boolean(existing),
  };
}

export function getPendingPunches(limit = BATCH_SIZE) {
  const db = getAgentDb();
  return db
    .prepare(
      `SELECT id, payload, status, created_at FROM punches
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(limit);
}

export function countPendingPunches() {
  const db = getAgentDb();
  const row = db.prepare(`SELECT COUNT(*) AS c FROM punches WHERE status = 'pending'`).get();
  return Number(row?.c || 0);
}

function markRowsSent(rows) {
  if (!rows.length) return;
  const db = getAgentDb();
  const stmt = db.prepare(`UPDATE punches SET status = 'sent', sent_at = ? WHERE id = ?`);
  const now = Date.now();
  const trx = db.transaction((list) => {
    for (const r of list) stmt.run(now, r.id);
  });
  trx(rows);
}

function markRowsFailed(rows, reason) {
  if (!rows.length) return;
  const db = getAgentDb();
  const stmt = db.prepare(`UPDATE punches SET status = 'failed', sent_at = ? WHERE id = ?`);
  const now = Date.now();
  const trx = db.transaction((list) => {
    for (const r of list) stmt.run(now, r.id);
  });
  trx(rows);
  agentLog.punchSendFailure({
    failed_count: rows.length,
    reason,
    ids: rows.map((r) => r.id).slice(0, 10),
  });
}

function bumpSyncBackoff() {
  syncDelayMs = Math.min(Math.max(syncDelayMs * 2, REP_BATCH_SYNC_MIN_MS), REP_BATCH_SYNC_MAX_MS);
}

function resetSyncBackoff() {
  syncDelayMs = REP_BATCH_SYNC_MIN_MS;
}

/**
 * Envia até BATCH_SIZE batidas pendentes. Falhas não derrubam o agente.
 * @returns {Promise<{ sent: number, duplicate: number, failed: number, pendingLeft: number }|null>}
 */
/**
 * @param {{ force?: boolean }} [opts] force=true ignora limiar de 50 (flush manual / fim de ciclo).
 */
export async function sendPunchBatch(opts = {}) {
  if (!queueConfig?.saas || !queueConfig?.apiKey) return null;
  if (syncBusy) return null;
  const pendingTotal = countPendingPunches();
  if (!opts.force && pendingTotal < MIN_SEND_BATCH) {
    return { sent: 0, duplicate: 0, failed: 0, pendingLeft: pendingTotal, skipped: true };
  }
  syncBusy = true;
  try {
    const rows = getPendingPunches(BATCH_SIZE);
    if (rows.length === 0) {
      resetSyncBackoff();
      return { sent: 0, duplicate: 0, failed: 0, pendingLeft: 0 };
    }

    const punches = rows.map((r) => {
      try {
        return JSON.parse(r.payload);
      } catch {
        return null;
      }
    }).filter(Boolean);

    if (punches.length === 0) {
      markRowsFailed(rows, 'payload_json_corrupt');
      return { sent: 0, duplicate: 0, failed: rows.length, pendingLeft: countPendingPunches() };
    }

    agentLog.punchSendStart({ batch_size: punches.length, pending_total: pendingTotal });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REP_BATCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${queueConfig.saas}/api/rep/punches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${queueConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ punches }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (data?.degraded === true) {
      const retryAfter = Math.max(15_000, Number(data.retry_after) || 60_000);
      observabilityConsole.warn('[BATCH DEGRADED]', data?.error || 'backend degradado', `retry=${retryAfter}ms`);
      scheduleSyncDelay(retryAfter);
      return {
        sent: 0,
        duplicate: 0,
        failed: 0,
        pendingLeft: countPendingPunches(),
        degraded: true,
        retry_after: retryAfter,
      };
    }

    if (!res.ok || !data || data.ok === false) {
      observabilityConsole.warn('[BATCH ERROR]', res.status, data?.error || text.slice(0, 500));
      bumpSyncBackoff();
      return { sent: 0, duplicate: 0, failed: punches.length, pendingLeft: countPendingPunches() };
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const byHash = new Map();
    for (const item of results) {
      const key =
        (typeof item?.punch_hash === 'string' && item.punch_hash) ||
        (typeof item?.hash === 'string' && item.hash) ||
        '';
      if (key) byHash.set(key, item);
    }

    const toMark = [];
    let sent = 0;
    let duplicate = 0;
    let failed = 0;

    const failureDetails = [];
    for (const row of rows) {
      const body = JSON.parse(row.payload);
      const id = punchQueueId(body);
      const item = byHash.get(id);
      const accepted =
        item?.success === true ||
        item?.duplicate === true ||
        item?.inserted === true ||
        item?.unresolved === true;
      if (accepted) {
        toMark.push(row);
        if (item?.duplicate) duplicate += 1;
        else sent += 1;
      } else {
        failed += 1;
        failureDetails.push({
          punch_hash: id,
          error: item?.error || (item ? 'rejeitado pela API' : 'sem resultado no lote (hash divergente?)'),
          company_id: body?.company_id ?? null,
        });
      }
    }

    if (toMark.length > 0) markRowsSent(toMark);
    if (failed === 0) resetSyncBackoff();
    else bumpSyncBackoff();

    const accepted = sent + duplicate;
    const uploadMeta = {
      device_id: punches[0]?.device_id ?? null,
      company_id: punches[0]?.company_id ?? null,
      records: punches.length,
      accepted,
      rejected: failed,
      duplicates: duplicate,
      execution_time_ms: null,
    };
    observabilityConsole.log(
      '[REP UPLOAD]',
      `records=${punches.length} accepted=${accepted} rejected=${failed} duplicates=${duplicate}`,
    );
    agentLog.repUpload(uploadMeta);

    const summary = {
      sent,
      duplicate,
      failed,
      pendingLeft: countPendingPunches(),
      processed: data.processed ?? punches.length,
      errors: data.errors ?? null,
      unresolved: data.unresolved ?? null,
      migration_error: data.migration_error === true,
    };
    if (sent > 0 || duplicate > 0) {
      agentLog.punchSendSuccess(summary);
    } else if (failed > 0) {
      if (failureDetails.length > 0) {
        observabilityConsole.warn('[PUNCH_SEND_DETAIL]', JSON.stringify(failureDetails));
      }
      agentLog.punchSendFailure({ ...summary, failure_details: failureDetails });
    }
    return summary;
  } catch (err) {
    observabilityConsole.warn('[BATCH ERROR]', err?.message || err);
    bumpSyncBackoff();
    return { sent: 0, duplicate: 0, failed: 0, pendingLeft: countPendingPunches() };
  } finally {
    syncBusy = false;
  }
}

function scheduleSyncDelay(ms) {
  syncDelayMs = Math.max(REP_BATCH_SYNC_MIN_MS, Math.min(ms, REP_BATCH_SYNC_MAX_MS));
}

function scheduleNextBatchSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void sendPunchBatch()
      .catch((e) => observabilityConsole.warn('[SYNC ERROR]', e?.message || e))
      .finally(() => scheduleNextBatchSync());
  }, syncDelayMs);
}

export function startPunchSyncLoop() {
  if (syncTimer) return;
  scheduleNextBatchSync();
  const mode = REP_LOW_COST_MODE ? 'low-cost' : 'normal';
  observabilityConsole.log(
    `[REP PUNCH QUEUE] sync sob demanda (${mode}, envia≥${MIN_SEND_BATCH}, lote≤${BATCH_SIZE}, intervalo=${REP_BATCH_SYNC_MIN_MS}–${REP_BATCH_SYNC_MAX_MS}ms)`,
  );
}

export function stopPunchSyncLoop() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

/** Drena a fila (fim de ciclo de coleta). */
export async function flushPunchQueue(maxRounds = 20) {
  for (let i = 0; i < maxRounds; i += 1) {
    const pending = countPendingPunches();
    if (pending === 0) return;
    const r = await sendPunchBatch({ force: true });
    if (!r || r.degraded) break;
    if (r.sent === 0 && r.duplicate === 0 && r.failed > 0) break;
  }
}
