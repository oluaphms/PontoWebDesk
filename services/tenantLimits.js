/**
 * Limites por tenant (billing / fair use).
 *
 * Controla:
 * - Batidas por dia por empresa
 * - Dispositivos ativos por empresa
 * - Armazenamento local estimado
 *
 * Comportamento ao exceder:
 * - Alerta imediato (webhook)
 * - Throttling opcional (configurável por tenant)
 * - Nunca descarta dados — apenas sinaliza
 *
 * Limites padrão (configuráveis via env ou tabela tenant_limits no Supabase):
 * - MAX_PUNCHES_PER_DAY:  10.000 por empresa
 * - MAX_DEVICES:          50 por empresa
 * - MAX_STORAGE_MB:       500 MB por empresa
 */

import { LOG_LEVEL } from './syncQueue.js';

const DEFAULT_LIMITS = {
  maxPunchesPerDay: parseInt(process.env.TENANT_MAX_PUNCHES_PER_DAY || '10000', 10),
  maxDevices:       parseInt(process.env.TENANT_MAX_DEVICES          || '50',    10),
  maxStorageMb:     parseInt(process.env.TENANT_MAX_STORAGE_MB       || '500',   10),
};

export class TenantLimits {
  /**
   * @param {{
   *   db:      import('better-sqlite3').Database,
   *   queue:   import('./syncQueue.js').SyncQueue,
   *   alerts?: import('./alertDispatcher.js').AlertDispatcher,
   * }} opts
   */
  constructor(opts) {
    this._db     = opts.db;
    this._queue  = opts.queue;
    this._alerts = opts.alerts ?? null;
    this._ensureSchema();
    // Contadores em memória por dia (reset à meia-noite)
    this._dailyCounts = new Map(); // companyId → { date, count }
    this._scheduleReset();
  }

  _ensureSchema() {
    try {
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS tenant_limits (
          company_id        TEXT PRIMARY KEY NOT NULL,
          max_punches_day   INTEGER NOT NULL DEFAULT ${DEFAULT_LIMITS.maxPunchesPerDay},
          max_devices       INTEGER NOT NULL DEFAULT ${DEFAULT_LIMITS.maxDevices},
          max_storage_mb    INTEGER NOT NULL DEFAULT ${DEFAULT_LIMITS.maxStorageMb},
          throttle_enabled  INTEGER NOT NULL DEFAULT 0,
          updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        )
      `);
    } catch { /* ignore */ }
  }

  _scheduleReset() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(0, 0, 5, 0); // 00:00:05 para evitar race condition
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(() => {
      this._dailyCounts.clear();
      this._scheduleReset();
    }, next.getTime() - now.getTime());
  }

  /**
   * Retorna os limites de uma empresa (custom ou default).
   * @param {string} companyId
   */
  getLimits(companyId) {
    try {
      const row = this._db.prepare(
        `SELECT max_punches_day, max_devices, max_storage_mb, throttle_enabled FROM tenant_limits WHERE company_id = ?`
      ).get(companyId);
      if (row) return {
        maxPunchesPerDay: row.max_punches_day,
        maxDevices:       row.max_devices,
        maxStorageMb:     row.max_storage_mb,
        throttleEnabled:  row.throttle_enabled === 1,
      };
    } catch { /* ignore */ }
    return { ...DEFAULT_LIMITS, throttleEnabled: false };
  }

  /**
   * Verifica se uma empresa pode receber mais batidas hoje.
   * Incrementa o contador e retorna { allowed, current, limit }.
   *
   * @param {string} companyId
   * @param {number} count — número de batidas a adicionar
   * @returns {{ allowed: boolean, current: number, limit: number, throttle: boolean }}
   */
  checkAndIncrement(companyId, count = 1) {
    const today   = new Date().toISOString().slice(0, 10);
    const limits  = this.getLimits(companyId);
    const entry   = this._dailyCounts.get(companyId);

    let current = 0;
    if (entry && entry.date === today) {
      current = entry.count;
    }

    const newCount = current + count;
    this._dailyCounts.set(companyId, { date: today, count: newCount });

    const allowed = newCount <= limits.maxPunchesPerDay;

    if (!allowed || newCount > limits.maxPunchesPerDay * 0.9) {
      const level = !allowed ? 'critical' : 'warn';
      this._queue.log(
        !allowed ? LOG_LEVEL.ERROR : LOG_LEVEL.WARN,
        'tenant_limits',
        `Empresa ${companyId}: ${newCount}/${limits.maxPunchesPerDay} batidas hoje`,
        { companyId, current: newCount, limit: limits.maxPunchesPerDay, allowed }
      );
      if (!allowed && this._alerts) {
        this._alerts.dispatch({
          type:    'tenant_limit_exceeded',
          level:   'critical',
          title:   'Limite de batidas excedido',
          message: `Empresa ${companyId}: ${newCount} batidas (limite: ${limits.maxPunchesPerDay}/dia)`,
          context: { companyId, current: newCount, limit: limits.maxPunchesPerDay },
        }).catch((err) => {
          this._queue.log(LOG_LEVEL.WARN, 'tenant_limits', 'Falha ao emitir alerta', { error: String(err) });
        });
      }
    }

    return {
      allowed,
      current: newCount,
      limit:   limits.maxPunchesPerDay,
      throttle: limits.throttleEnabled && !allowed,
    };
  }

  /**
   * Retorna contagem atual do dia para uma empresa.
   * @param {string} companyId
   */
  getDailyCount(companyId) {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this._dailyCounts.get(companyId);
    return entry?.date === today ? entry.count : 0;
  }
}
