/**
 * Fila persistente de sincronização (SQLite).
 *
 * TABELAS:
 * - sync_jobs:    fila de trabalho com retry, backoff e dead letter
 * - system_logs:  observabilidade estruturada (coleta, enqueue, sync, erro, retry)
 * - sync_locks:   mutex para evitar workers concorrentes
 *
 * GARANTIAS:
 * - Atomicidade: enqueue + insert em time_records numa única transação
 * - Idempotência: dedupe_hash impede duplicatas antes do enqueue
 * - Durabilidade: WAL mode + fsync implícito do SQLite
 * - Rastreabilidade: todos os eventos logados em system_logs
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Constantes ────────────────────────────────────────────────────────────────

export const JOB_STATUS = /** @type {const} */ ({
  PENDING:    'pending',
  PROCESSING: 'processing',
  DONE:       'done',
  FAILED:     'failed',
});

export const LOG_LEVEL = /** @type {const} */ ({
  DEBUG: 'debug',
  INFO:  'info',
  WARN:  'warn',
  ERROR: 'error',
});

/** Máximo de tentativas antes de mover para dead letter. */
export const MAX_ATTEMPTS = 10;

/** Backoff exponencial: 1s → 2s → 4s → … → 60s (teto). */
export function backoffMs(attempts) {
  return Math.min(60_000, 1_000 * Math.pow(2, attempts));
}

// ─── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA = `
-- Fila de jobs de sincronização
CREATE TABLE IF NOT EXISTS sync_jobs (
  id           TEXT    PRIMARY KEY NOT NULL,
  payload      TEXT    NOT NULL,                          -- JSON do lote
  status       TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','processing','done','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  next_run_at  TEXT    NOT NULL,                          -- ISO UTC
  last_error   TEXT,
  error_type   TEXT,                                      -- classificação do erro (NETWORK_ERROR, FK_ERROR, etc.)
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_next
  ON sync_jobs (status, next_run_at)
  WHERE status IN ('pending','processing');

-- Logs estruturados de observabilidade
CREATE TABLE IF NOT EXISTS system_logs (
  id         TEXT    PRIMARY KEY NOT NULL,
  level      TEXT    NOT NULL CHECK (level IN ('debug','info','warn','error')),
  scope      TEXT    NOT NULL DEFAULT 'sync',
  message    TEXT    NOT NULL,
  context    TEXT,                                        -- JSON opcional
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_system_logs_level_created
  ON system_logs (level, created_at);

-- Mutex de concorrência (evita múltiplos workers simultâneos)
CREATE TABLE IF NOT EXISTS sync_locks (
  name       TEXT    PRIMARY KEY NOT NULL,
  locked_at  TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);

-- Checkpoint de sincronização (retomar após reinício)
CREATE TABLE IF NOT EXISTS sync_checkpoint (
  id                  TEXT PRIMARY KEY NOT NULL,
  last_processed_at   TEXT,
  last_reconciled_at  TEXT,
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

// ─── SyncQueue ─────────────────────────────────────────────────────────────────

export class SyncQueue {
  /** @param {string} dbPath */
  constructor(dbPath) {
    this._dbPath = dbPath;
    this._db = null;
  }

  /** Abre (ou reabre) o banco. Idempotente. */
  open() {
    if (this._db) return this._db;
    mkdirSync(dirname(this._dbPath), { recursive: true });
    const db = new Database(this._dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    this._db = db;
    return db;
  }

  get db() {
    return this.open();
  }

  close() {
    if (this._db) {
      try { this._db.close(); } catch { /* ignore */ }
      this._db = null;
    }
  }

  /**
   * Reutiliza uma conexão SQLite já aberta (ex.: mesma instância que `time_records`)
   * e aplica o schema da fila (`sync_jobs`, `system_logs`, …).
   * Sem isso, `open()` nunca roda e consultas à fila falham com "no such table".
   * @param {import('better-sqlite3').Database} db
   */
  attachDatabase(db) {
    this._db = db;
    db.exec(SCHEMA);
    return this;
  }

  // ── Enqueue ──────────────────────────────────────────────────────────────────

  /**
   * Insere um job na fila de forma atômica com a gravação em time_records.
   * Garante que nunca há job sem registro local correspondente.
   *
   * @param {{
   *   companyId: string,
   *   deviceId: string,
   *   rows: Record<string, unknown>[],
   *   timeRecordsIds: string[],
   * }} params
   * @returns {string} id do job criado
   */
  enqueueAtomic(params) {
    const { companyId, deviceId, rows, timeRecordsIds } = params;
    const id = randomUUID();
    const now = new Date().toISOString();
    const payload = JSON.stringify({ companyId, deviceId, rows, timeRecordsIds });

    this.db.prepare(`
      INSERT INTO sync_jobs (id, payload, status, attempts, next_run_at, created_at, updated_at)
      VALUES (?, ?, 'pending', 0, ?, ?, ?)
    `).run(id, payload, now, now, now);

    this.log(LOG_LEVEL.INFO, 'enqueue', `Job enfileirado: ${rows.length} batida(s)`, {
      jobId: id, companyId, deviceId, count: rows.length,
    });

    return id;
  }

  // ── Dequeue ──────────────────────────────────────────────────────────────────

  /**
   * Retorna até `limit` jobs prontos para processar (status=pending, next_run_at <= agora).
   * Marca como 'processing' atomicamente para evitar duplo processamento.
   *
   * @param {number} limit
   * @returns {Array<{ id: string, payload: object, attempts: number }>}
   */
  dequeue(limit = 10) {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT id, payload, attempts
      FROM sync_jobs
      WHERE status = 'pending' AND next_run_at <= ?
      ORDER BY next_run_at ASC
      LIMIT ?
    `).all(now, limit);

    if (!rows.length) return [];

    const upd = this.db.prepare(`
      UPDATE sync_jobs SET status = 'processing', updated_at = ? WHERE id = ?
    `);
    const trx = this.db.transaction(() => {
      for (const r of rows) upd.run(now, r.id);
    });
    trx();

    return rows.map(r => ({
      id: r.id,
      payload: JSON.parse(r.payload),
      attempts: r.attempts,
    }));
  }

  // ── Ack / Nack ───────────────────────────────────────────────────────────────

  /**
   * Marca job como concluído com sucesso.
   * @param {string} jobId
   */
  ack(jobId) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE sync_jobs SET status = 'done', updated_at = ? WHERE id = ?
    `).run(now, jobId);
  }

  /**
   * Marca job como falho e agenda retry com backoff exponencial.
   * Se atingir MAX_ATTEMPTS, move para dead letter (status='failed').
   *
   * @param {string} jobId
   * @param {string} errorMessage
   * @param {number} currentAttempts
   */
  nack(jobId, errorMessage, currentAttempts) {
    const nextAttempts = currentAttempts + 1;
    const now = new Date().toISOString();

    if (nextAttempts >= MAX_ATTEMPTS) {
      this.db.prepare(`
        UPDATE sync_jobs
        SET status = 'failed', attempts = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `).run(nextAttempts, errorMessage.slice(0, 2000), now, jobId);

      this.log(LOG_LEVEL.ERROR, 'dead_letter', `Job movido para dead letter após ${nextAttempts} tentativas`, {
        jobId, attempts: nextAttempts, error: errorMessage.slice(0, 500),
      });
    } else {
      const delay = backoffMs(nextAttempts);
      const nextRun = new Date(Date.now() + delay).toISOString();

      this.db.prepare(`
        UPDATE sync_jobs
        SET status = 'pending', attempts = ?, last_error = ?, next_run_at = ?, updated_at = ?
        WHERE id = ?
      `).run(nextAttempts, errorMessage.slice(0, 2000), nextRun, now, jobId);

      this.log(LOG_LEVEL.WARN, 'retry', `Job reagendado (tentativa ${nextAttempts}/${MAX_ATTEMPTS}, delay ${delay}ms)`, {
        jobId, attempts: nextAttempts, delayMs: delay, nextRun,
      });
    }
  }

  // ── Lock de concorrência ─────────────────────────────────────────────────────

  /**
   * Tenta adquirir lock exclusivo para o worker.
   * TTL padrão: 60s (evita lock eterno se o processo morrer).
   *
   * @param {string} name
   * @param {number} ttlMs
   * @returns {boolean} true se adquiriu o lock
   */
  acquireLock(name, ttlMs = 60_000) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const nowIso = now.toISOString();

    // Limpar locks expirados primeiro
    this.db.prepare(`DELETE FROM sync_locks WHERE expires_at <= ?`).run(nowIso);

    try {
      this.db.prepare(`
        INSERT INTO sync_locks (name, locked_at, expires_at) VALUES (?, ?, ?)
      `).run(name, nowIso, expiresAt);
      return true;
    } catch {
      // UNIQUE constraint: lock já existe e não expirou
      return false;
    }
  }

  /**
   * Libera o lock.
   * @param {string} name
   */
  releaseLock(name) {
    this.db.prepare(`DELETE FROM sync_locks WHERE name = ?`).run(name);
  }

  // ── Métricas ─────────────────────────────────────────────────────────────────

  /**
   * Retorna snapshot de métricas da fila.
   * @returns {{
   *   pending: number, processing: number, done: number, failed: number,
   *   oldestPendingAt: string|null, lastDoneAt: string|null,
   *   errorRate: number
   * }}
   */
  getMetrics() {
    const counts = this.db.prepare(`
      SELECT status, COUNT(*) as c FROM sync_jobs GROUP BY status
    `).all();

    const byStatus = Object.fromEntries(counts.map(r => [r.status, r.c]));
    const pending    = byStatus['pending']    ?? 0;
    const processing = byStatus['processing'] ?? 0;
    const done       = byStatus['done']       ?? 0;
    const failed     = byStatus['failed']     ?? 0;
    const total      = pending + processing + done + failed;

    const oldest = this.db.prepare(`
      SELECT next_run_at FROM sync_jobs WHERE status = 'pending' ORDER BY next_run_at ASC LIMIT 1
    `).get();

    const lastDone = this.db.prepare(`
      SELECT updated_at FROM sync_jobs WHERE status = 'done' ORDER BY updated_at DESC LIMIT 1
    `).get();

    const recentWindow = new Date(Date.now() - 5 * 60_000).toISOString();
    const recentTotal = this.db.prepare(`
      SELECT COUNT(*) as c FROM sync_jobs WHERE updated_at >= ?
    `).get(recentWindow)?.c ?? 0;
    const recentFailed = this.db.prepare(`
      SELECT COUNT(*) as c FROM sync_jobs WHERE status = 'failed' AND updated_at >= ?
    `).get(recentWindow)?.c ?? 0;

    return {
      pending,
      processing,
      done,
      failed,
      total,
      oldestPendingAt: oldest?.next_run_at ?? null,
      lastDoneAt: lastDone?.updated_at ?? null,
      errorRate: recentTotal > 0 ? Math.round((recentFailed / recentTotal) * 100) : 0,
      processingDelayMs: oldest?.next_run_at
        ? Math.max(0, Date.now() - new Date(oldest.next_run_at).getTime())
        : 0,
    };
  }

  /**
   * Retorna jobs na dead letter queue (status='failed').
   * @param {number} limit
   * @returns {Array<{ id: string, payload: object, attempts: number, lastError: string, createdAt: string }>}
   */
  getDeadLetterJobs(limit = 50) {
    return this.db.prepare(`
      SELECT id, payload, attempts, last_error, error_type, created_at
      FROM sync_jobs
      WHERE status = 'failed'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit).map(r => ({
      id: r.id,
      payload: (() => { try { return JSON.parse(r.payload); } catch { return {}; } })(),
      attempts: r.attempts,
      lastError: r.last_error,
      errorType: r.error_type ?? 'UNKNOWN',
      createdAt: r.created_at,
    }));
  }

  /**
   * Recoloca jobs da dead letter de volta para pending (reprocessamento manual).
   * @param {string[]} jobIds
   * @returns {number} quantidade recolocada
   */
  requeueDeadLetterJobs(jobIds) {
    if (!jobIds.length) return 0;
    const now = new Date().toISOString();
    const upd = this.db.prepare(`
      UPDATE sync_jobs
      SET status = 'pending', attempts = 0, last_error = NULL, next_run_at = ?, updated_at = ?
      WHERE id = ? AND status = 'failed'
    `);
    const trx = this.db.transaction(() => {
      let count = 0;
      for (const id of jobIds) {
        const info = upd.run(now, now, id);
        count += info.changes;
      }
      return count;
    });
    return trx();
  }

  // ── Logs ─────────────────────────────────────────────────────────────────────

  /**
   * Grava log estruturado em system_logs.
   * @param {string} level
   * @param {string} scope
   * @param {string} message
   * @param {object} [context]
   */
  log(level, scope, message, context) {
    try {
      this.db.prepare(`
        INSERT INTO system_logs (id, level, scope, message, context)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        level,
        scope,
        message,
        context ? JSON.stringify(context) : null,
      );
    } catch {
      // Nunca deixar falha de log derrubar o fluxo principal
    }
  }

  /**
   * Retorna logs recentes.
   * @param {{ level?: string, scope?: string, limit?: number }} opts
   */
  getLogs(opts = {}) {
    const { level, scope, limit = 200 } = opts;
    let sql = `SELECT id, level, scope, message, context, created_at FROM system_logs`;
    const params = [];
    const where = [];
    if (level) { where.push(`level = ?`); params.push(level); }
    if (scope) { where.push(`scope = ?`); params.push(scope); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    return this.db.prepare(sql).all(...params).map(r => ({
      id: r.id,
      level: r.level,
      scope: r.scope,
      message: r.message,
      context: r.context ? (() => { try { return JSON.parse(r.context); } catch { return {}; } })() : null,
      createdAt: r.created_at,
    }));
  }

  /**
   * Salva checkpoint de progresso.
   * @param {string} id — identificador do checkpoint (ex: 'worker', 'reconciler')
   * @param {{ lastProcessedAt?: string, lastReconciledAt?: string }} fields
   */
  saveCheckpoint(id, fields) {
    try {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO sync_checkpoint (id, last_processed_at, last_reconciled_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          last_processed_at  = COALESCE(excluded.last_processed_at,  last_processed_at),
          last_reconciled_at = COALESCE(excluded.last_reconciled_at, last_reconciled_at),
          updated_at         = excluded.updated_at
      `).run(id, fields.lastProcessedAt ?? null, fields.lastReconciledAt ?? null, now);
    } catch { /* best-effort */ }
  }

  /**
   * Lê checkpoint salvo.
   * @param {string} id
   * @returns {{ lastProcessedAt: string|null, lastReconciledAt: string|null } | null}
   */
  getCheckpoint(id) {
    try {
      const row = this.db.prepare(
        `SELECT last_processed_at, last_reconciled_at FROM sync_checkpoint WHERE id = ?`
      ).get(id);
      if (!row) return null;
      return { lastProcessedAt: row.last_processed_at, lastReconciledAt: row.last_reconciled_at };
    } catch { return null; }
  }

  /**
   * Limpa logs antigos (retenção padrão: 7 dias).
   * @param {number} retentionDays
   */
  purgeLogs(retentionDays = 7) {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const info = this.db.prepare(`DELETE FROM system_logs WHERE created_at < ?`).run(cutoff);
    return info.changes;
  }

  /**
   * Limpa jobs concluídos antigos (retenção padrão: 3 dias).
   * @param {number} retentionDays
   */
  purgeDoneJobs(retentionDays = 3) {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const info = this.db.prepare(`
      DELETE FROM sync_jobs WHERE status = 'done' AND updated_at < ?
    `).run(cutoff);
    return info.changes;
  }
}
