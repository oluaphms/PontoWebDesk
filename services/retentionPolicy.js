import { observabilityConsole } from './observabilityConsole.js';
/**
 * Política de retenção e conformidade LGPD.
 *
 * REGRAS:
 * - Registros de ponto: retenção mínima de 5 anos (Portaria 671 / CLT art. 74)
 * - Após 5 anos: anonimização dos dados pessoais (PIS/CPF → hash irreversível)
 * - Logs de sistema: 90 dias
 * - Audit trail: 5 anos (mesmo prazo dos registros)
 * - Snapshots locais: 7 dias (já implementado no SnapshotService)
 *
 * ANONIMIZAÇÃO:
 * - employee_id, p_pis, p_cpf → SHA-256 com salt por empresa (irreversível)
 * - p_matricula → mantida (não é dado pessoal sensível)
 * - p_raw_data → campos pessoais removidos
 *
 * EXECUÇÃO:
 * - Roda mensalmente (1º dia do mês, 03:00)
 * - Apenas em registros com p_data_hora < (now - 5 anos)
 * - Registra cada anonimização na audit_trail
 */

import { createHash } from 'node:crypto';
import { LOG_LEVEL }  from './syncQueue.js';

const RETENTION_YEARS   = 5;
const RETENTION_MS      = RETENTION_YEARS * 365.25 * 86_400_000;
const ANON_BATCH_SIZE   = 500;

/**
 * Gera hash irreversível de um dado pessoal com salt por empresa.
 * @param {string} value
 * @param {string} companySalt
 * @returns {string}
 */
function anonymize(value, companySalt) {
  if (!value) return value;
  return 'ANON:' + createHash('sha256')
    .update(`${companySalt}:${value}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

export class RetentionPolicy {
  /**
   * @param {{
   *   db:     import('better-sqlite3').Database,
   *   queue:  import('./syncQueue.js').SyncQueue,
   *   audit?: import('./auditTrail.js').AuditTrail,
   *   retentionYears?: number,
   * }} opts
   */
  constructor(opts) {
    this._db      = opts.db;
    this._queue   = opts.queue;
    this._audit   = opts.audit ?? null;
    this._retMs   = (opts.retentionYears ?? RETENTION_YEARS) * 365.25 * 86_400_000;
    this._timer   = null;
  }

  start() {
    this._scheduleNext();
    return this;
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  _scheduleNext() {
    // Próximo 1º do mês às 03:00
    const now  = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 3, 0, 0, 0);
    const delay = next.getTime() - now.getTime();
    this._timer = setTimeout(() => {
      this.runAnonymization().catch(e => {
        const msg = e instanceof Error ? e.message : String(e);
        this._queue.log(LOG_LEVEL.ERROR, 'retention', `Anonimização falhou: ${msg}`);
      });
      this._scheduleNext();
    }, delay);
  }

  /**
   * Executa anonimização de registros expirados.
   * @returns {Promise<{ anonymized: number, skipped: number }>}
   */
  async runAnonymization() {
    const cutoff = new Date(Date.now() - this._retMs).toISOString();
    this._queue.log(LOG_LEVEL.INFO, 'retention', `Iniciando anonimização (cutoff: ${cutoff})`);

    let anonymized = 0;
    let skipped    = 0;
    let offset     = 0;

    while (true) {
      const rows = this._db.prepare(`
        SELECT id, company_id, p_pis, p_cpf, p_matricula, p_raw_data
        FROM time_records
        WHERE p_data_hora < ?
          AND (p_pis NOT LIKE 'ANON:%' OR p_cpf NOT LIKE 'ANON:%')
        ORDER BY p_data_hora ASC
        LIMIT ? OFFSET ?
      `).all(cutoff, ANON_BATCH_SIZE, offset);

      if (!rows.length) break;

      const upd = this._db.prepare(`
        UPDATE time_records
        SET p_pis = ?, p_cpf = ?, p_raw_data = ?
        WHERE id = ?
      `);

      const trx = this._db.transaction(() => {
        for (const r of rows) {
          const salt    = r.company_id ?? 'default';
          const anonPis = r.p_pis ? anonymize(r.p_pis, salt) : r.p_pis;
          const anonCpf = r.p_cpf ? anonymize(r.p_cpf, salt) : r.p_cpf;

          // Remover campos pessoais do raw_data
          let rawObj = {};
          try { rawObj = r.p_raw_data ? JSON.parse(r.p_raw_data) : {}; } catch { rawObj = {}; }
          const { pis, cpf, nome, name, employee_name, ...safeRaw } = rawObj;
          safeRaw._anonymized_at = new Date().toISOString();

          upd.run(anonPis, anonCpf, JSON.stringify(safeRaw), r.id);

          // Registrar na audit trail
          this._audit?.record({
            entity:      'time_records',
            entityId:    r.id,
            action:      'LGPD_ANONYMIZED',
            before:      { p_pis: r.p_pis ? '[REDACTED]' : null, p_cpf: r.p_cpf ? '[REDACTED]' : null },
            after:       { p_pis: anonPis, p_cpf: anonCpf },
            performedBy: 'retention_policy',
            companyId:   r.company_id,
          });

          anonymized++;
        }
      });
      trx();

      offset += rows.length;
      if (rows.length < ANON_BATCH_SIZE) break;
    }

    this._queue.log(LOG_LEVEL.INFO, 'retention',
      `Anonimização concluída: ${anonymized} registros`,
      { anonymized, skipped, cutoff });

    observabilityConsole.log(`[RETENTION] ✓ ${anonymized} registros anonimizados (LGPD, cutoff: ${cutoff})`);
    return { anonymized, skipped };
  }

  /**
   * Retorna contagem de registros que serão anonimizados na próxima execução.
   * @returns {{ pending: number, cutoff: string }}
   */
  getPendingCount() {
    const cutoff = new Date(Date.now() - this._retMs).toISOString();
    try {
      const row = this._db.prepare(`
        SELECT COUNT(*) as c FROM time_records
        WHERE p_data_hora < ?
          AND (p_pis NOT LIKE 'ANON:%' OR p_cpf NOT LIKE 'ANON:%')
      `).get(cutoff);
      return { pending: row?.c ?? 0, cutoff };
    } catch {
      return { pending: 0, cutoff };
    }
  }
}
