/**
 * Métricas por tenant (empresa).
 *
 * Registra e agrega:
 * - Latência média de sync por empresa
 * - Taxa de erro por empresa
 * - Volume de batidas por empresa
 * - Último sync por empresa
 *
 * Armazenado em SQLite local (tenant_metrics) para consulta rápida.
 * Permite priorização e diagnóstico por cliente.
 */

import { LOG_LEVEL } from './syncQueue.js';
import { observabilityConsole } from './observabilityConsole.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenant_metrics (
  company_id       TEXT    PRIMARY KEY NOT NULL,
  total_punches    INTEGER NOT NULL DEFAULT 0,
  total_synced     INTEGER NOT NULL DEFAULT 0,
  total_errors     INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms   REAL    NOT NULL DEFAULT 0,
  last_sync_at     TEXT,
  last_error_at    TEXT,
  last_error_msg   TEXT,
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

export class TenantMetrics {
  /**
   * @param {{ db: import('better-sqlite3').Database }} opts
   */
  constructor(opts) {
    this._db = opts.db;
    try {
      this._db.exec(SCHEMA);
    } catch (error) {
      observabilityConsole.warn('[tenantMetrics] Falha ao garantir schema:', error);
    }
  }

  /**
   * Registra um sync bem-sucedido para uma empresa.
   * @param {string} companyId
   * @param {{ count: number, latencyMs: number }} data
   */
  recordSync(companyId, { count, latencyMs }) {
    const now = new Date().toISOString();
    try {
      this._db.prepare(`
        INSERT INTO tenant_metrics (company_id, total_punches, total_synced, avg_latency_ms, last_sync_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id) DO UPDATE SET
          total_punches  = total_punches  + excluded.total_punches,
          total_synced   = total_synced   + excluded.total_synced,
          avg_latency_ms = (avg_latency_ms * 0.8 + excluded.avg_latency_ms * 0.2),
          last_sync_at   = excluded.last_sync_at,
          updated_at     = excluded.updated_at
      `).run(companyId, count, count, latencyMs, now, now);
    } catch (error) {
      observabilityConsole.warn('[tenantMetrics] Falha ao registrar sync:', error);
    }
  }

  /**
   * Registra um erro de sync para uma empresa.
   * @param {string} companyId
   * @param {string} errorMsg
   */
  recordError(companyId, errorMsg) {
    const now = new Date().toISOString();
    try {
      this._db.prepare(`
        INSERT INTO tenant_metrics (company_id, total_errors, last_error_at, last_error_msg, updated_at)
        VALUES (?, 1, ?, ?, ?)
        ON CONFLICT(company_id) DO UPDATE SET
          total_errors   = total_errors + 1,
          last_error_at  = excluded.last_error_at,
          last_error_msg = excluded.last_error_msg,
          updated_at     = excluded.updated_at
      `).run(companyId, now, errorMsg.slice(0, 500), now);
    } catch (error) {
      observabilityConsole.warn('[tenantMetrics] Falha ao registrar erro:', error);
    }
  }

  /**
   * Retorna métricas de todas as empresas.
   * @param {{ limit?: number }} [opts]
   */
  getAll(opts = {}) {
    const limit = opts.limit ?? 100;
    return this._db.prepare(`
      SELECT company_id, total_punches, total_synced, total_errors,
             ROUND(avg_latency_ms) as avg_latency_ms,
             last_sync_at, last_error_at, last_error_msg, updated_at
      FROM tenant_metrics
      ORDER BY total_punches DESC
      LIMIT ?
    `).all(limit).map(r => ({
      companyId:    r.company_id,
      totalPunches: r.total_punches,
      totalSynced:  r.total_synced,
      totalErrors:  r.total_errors,
      avgLatencyMs: r.avg_latency_ms,
      errorRate:    r.total_punches > 0
        ? Math.round((r.total_errors / r.total_punches) * 100)
        : 0,
      lastSyncAt:   r.last_sync_at,
      lastErrorAt:  r.last_error_at,
      lastErrorMsg: r.last_error_msg,
      updatedAt:    r.updated_at,
    }));
  }

  /**
   * Retorna métricas de uma empresa específica.
   * @param {string} companyId
   */
  get(companyId) {
    const r = this._db.prepare(`SELECT * FROM tenant_metrics WHERE company_id = ?`).get(companyId);
    if (!r) return null;
    return {
      companyId:    r.company_id,
      totalPunches: r.total_punches,
      totalSynced:  r.total_synced,
      totalErrors:  r.total_errors,
      avgLatencyMs: Math.round(r.avg_latency_ms),
      errorRate:    r.total_punches > 0
        ? Math.round((r.total_errors / r.total_punches) * 100)
        : 0,
      lastSyncAt:   r.last_sync_at,
      lastErrorAt:  r.last_error_at,
      lastErrorMsg: r.last_error_msg,
    };
  }
}
