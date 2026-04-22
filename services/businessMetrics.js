/**
 * Métricas de negócio — observabilidade comercial.
 *
 * MÉTRICAS:
 * - Batidas por dia (total e por empresa)
 * - Empresas ativas (últimas 24h, 7d, 30d)
 * - Crescimento MoM (month-over-month)
 * - Custo estimado por tenant (processamento + armazenamento)
 * - Dispositivos ativos
 *
 * CUSTO ESTIMADO (configurável):
 * - COST_PER_1K_PUNCHES:  R$ 0.10 por 1000 batidas processadas
 * - COST_PER_GB_STORAGE:  R$ 0.50 por GB/mês
 * - COST_PER_DEVICE_DAY:  R$ 0.01 por dispositivo/dia
 *
 * Armazenado em SQLite local (business_metrics) + Supabase (agregados diários).
 */

import { LOG_LEVEL } from './syncQueue.js';

const COST_PER_1K_PUNCHES = parseFloat(process.env.COST_PER_1K_PUNCHES || '0.10');
const COST_PER_GB_STORAGE = parseFloat(process.env.COST_PER_GB_STORAGE  || '0.50');
const COST_PER_DEVICE_DAY = parseFloat(process.env.COST_PER_DEVICE_DAY  || '0.01');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS business_metrics (
  id           TEXT PRIMARY KEY NOT NULL,
  date         TEXT NOT NULL,
  company_id   TEXT,
  metric       TEXT NOT NULL,
  value        REAL NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_biz_date_metric ON business_metrics (date, metric);
CREATE INDEX IF NOT EXISTS idx_biz_company     ON business_metrics (company_id, date);
`;

export class BusinessMetrics {
  /**
   * @param {{
   *   db:       import('better-sqlite3').Database,
   *   queue:    import('./syncQueue.js').SyncQueue,
   *   supabase?: import('@supabase/supabase-js').SupabaseClient,
   * }} opts
   */
  constructor(opts) {
    this._db       = opts.db;
    this._queue    = opts.queue;
    this._supabase = opts.supabase ?? null;
    this._timer    = null;
    try {
      this._db.exec(SCHEMA);
    } catch (err) {
      console.warn('[businessMetrics] Falha ao garantir schema:', err);
    }
  }

  start() {
    // Agregar métricas diárias à meia-noite
    this._scheduleDaily();
    return this;
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  _scheduleDaily() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(0, 5, 0, 0); // 00:05 para pegar o dia anterior completo
    if (next <= now) next.setDate(next.getDate() + 1);
    this._timer = setTimeout(() => {
      this._aggregateDaily().catch((err) => {
        console.warn('[businessMetrics] Falha ao agregar métricas diárias:', err);
      });
      this._scheduleDaily();
    }, next.getTime() - now.getTime());
  }

  // ── Registro em tempo real ────────────────────────────────────────────────

  /**
   * Registra batidas processadas para uma empresa.
   * @param {string} companyId
   * @param {number} count
   */
  recordPunches(companyId, count) {
    const date = new Date().toISOString().slice(0, 10);
    this._upsertMetric(date, companyId, 'punches_processed', count);
  }

  /**
   * Registra dispositivo ativo.
   * @param {string} companyId
   */
  recordDeviceActive(companyId) {
    const date = new Date().toISOString().slice(0, 10);
    this._upsertMetric(date, companyId, 'devices_active', 1);
  }

  _upsertMetric(date, companyId, metric, increment) {
    try {
      const id = `${date}:${companyId ?? 'global'}:${metric}`;
      this._db.prepare(`
        INSERT INTO business_metrics (id, date, company_id, metric, value)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET value = value + excluded.value
      `).run(id, date, companyId ?? null, metric, increment);
    } catch { /* ignore */ }
  }

  // ── Agregação diária ──────────────────────────────────────────────────────

  async _aggregateDaily() {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    try {
      const rows = this._db.prepare(`
        SELECT company_id, metric, SUM(value) as total
        FROM business_metrics
        WHERE date = ?
        GROUP BY company_id, metric
      `).all(yesterday);

      if (this._supabase && rows.length) {
        await this._supabase.from('business_metrics_daily').upsert(
          rows.map(r => ({
            date:       yesterday,
            company_id: r.company_id,
            metric:     r.metric,
            value:      r.total,
          })),
          { onConflict: 'date,company_id,metric', ignoreDuplicates: false }
        ).catch(() => {});
      }

      this._queue.log(LOG_LEVEL.INFO, 'business_metrics',
        `Métricas diárias agregadas para ${yesterday}: ${rows.length} registros`);
    } catch { /* best-effort */ }
  }

  // ── Consultas ─────────────────────────────────────────────────────────────

  /**
   * Retorna métricas de negócio consolidadas.
   * @param {{ days?: number }} opts
   */
  getSummary(opts = {}) {
    const { days = 30 } = opts;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    try {
      const totalPunches = this._db.prepare(`
        SELECT SUM(value) as total FROM business_metrics
        WHERE metric = 'punches_processed' AND date >= ?
      `).get(cutoff)?.total ?? 0;

      const activeCompanies = this._db.prepare(`
        SELECT COUNT(DISTINCT company_id) as c FROM business_metrics
        WHERE metric = 'punches_processed' AND date >= ? AND company_id IS NOT NULL
      `).get(cutoff)?.c ?? 0;

      const today = new Date().toISOString().slice(0, 10);
      const todayPunches = this._db.prepare(`
        SELECT SUM(value) as total FROM business_metrics
        WHERE metric = 'punches_processed' AND date = ?
      `).get(today)?.total ?? 0;

      // Crescimento MoM
      const thisMonth = new Date().toISOString().slice(0, 7);
      const lastMonth = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 7);
      const thisMonthTotal = this._db.prepare(`
        SELECT SUM(value) as total FROM business_metrics
        WHERE metric = 'punches_processed' AND date LIKE ?
      `).get(`${thisMonth}%`)?.total ?? 0;
      const lastMonthTotal = this._db.prepare(`
        SELECT SUM(value) as total FROM business_metrics
        WHERE metric = 'punches_processed' AND date LIKE ?
      `).get(`${lastMonth}%`)?.total ?? 0;

      const growthMoM = lastMonthTotal > 0
        ? Math.round(((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100)
        : 0;

      return {
        period:          `${days} days`,
        totalPunches:    Math.round(totalPunches),
        todayPunches:    Math.round(todayPunches),
        activeCompanies,
        growthMoM:       `${growthMoM > 0 ? '+' : ''}${growthMoM}%`,
        estimatedCost:   this._estimateCost(totalPunches, activeCompanies, days),
      };
    } catch { return { period: `${days} days`, totalPunches: 0, activeCompanies: 0 }; }
  }

  /**
   * Retorna custo estimado por tenant.
   * @param {string} companyId
   * @param {{ days?: number }} opts
   */
  getTenantCost(companyId, opts = {}) {
    const { days = 30 } = opts;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    try {
      const punches = this._db.prepare(`
        SELECT SUM(value) as total FROM business_metrics
        WHERE metric = 'punches_processed' AND company_id = ? AND date >= ?
      `).get(companyId, cutoff)?.total ?? 0;

      const devices = this._db.prepare(`
        SELECT SUM(value) as total FROM business_metrics
        WHERE metric = 'devices_active' AND company_id = ? AND date >= ?
      `).get(companyId, cutoff)?.total ?? 0;

      return {
        companyId,
        period:        `${days} days`,
        punches:       Math.round(punches),
        devices:       Math.round(devices),
        estimatedCost: this._estimateCost(punches, 1, days, devices),
      };
    } catch { return { companyId, period: `${days} days`, punches: 0, estimatedCost: 0 }; }
  }

  _estimateCost(punches, companies, days, devices = 0) {
    const punchCost   = (punches / 1000) * COST_PER_1K_PUNCHES;
    const deviceCost  = devices * COST_PER_DEVICE_DAY * days;
    // Estimativa de armazenamento: ~1KB por batida
    const storageMb   = punches * 0.001;
    const storageCost = (storageMb / 1024) * COST_PER_GB_STORAGE;
    return {
      punch:   Math.round(punchCost * 100) / 100,
      device:  Math.round(deviceCost * 100) / 100,
      storage: Math.round(storageCost * 100) / 100,
      total:   Math.round((punchCost + deviceCost + storageCost) * 100) / 100,
      currency: 'BRL',
    };
  }
}
