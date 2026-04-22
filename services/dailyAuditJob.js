/**
 * Job de auditoria contínua automática.
 *
 * Executa diariamente:
 * 1. verifyIntegrity()       — verifica hash chain da trilha local
 * 2. verifyInAnchor()        — verifica âncoras de timestamp
 * 3. Gera relatório diário   — salvo em system_logs + Supabase
 * 4. Alerta se violação      — webhook crítico imediato
 *
 * Horário: 01:00 (horário local, após âncora das 23:55)
 *
 * Endpoint para consulta: GET /api/admin/audit/daily-report
 */

import { LOG_LEVEL } from './syncQueue.js';

export class DailyAuditJob {
  /**
   * @param {{
   *   audit:   import('./auditTrail.js').AuditTrail,
   *   anchor:  import('./timestampSigner.js').TimestampAnchor,
   *   queue:   import('./syncQueue.js').SyncQueue,
   *   alerts:  import('./alertDispatcher.js').AlertDispatcher,
   *   supabase?: import('@supabase/supabase-js').SupabaseClient,
   * }} opts
   */
  constructor(opts) {
    this._audit    = opts.audit;
    this._anchor   = opts.anchor;
    this._queue    = opts.queue;
    this._alerts   = opts.alerts;
    this._supabase = opts.supabase ?? null;
    this._timer    = null;
    this._lastReport = null;
  }

  start() {
    this._scheduleNext();
    this._queue.log(LOG_LEVEL.INFO, 'daily_audit', 'Job de auditoria diária iniciado');
    return this;
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  _scheduleNext() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(1, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    this._timer = setTimeout(() => {
      this.run().catch(e => {
        const msg = e instanceof Error ? e.message : String(e);
        this._queue.log(LOG_LEVEL.ERROR, 'daily_audit', `Job falhou: ${msg}`);
      });
      this._scheduleNext();
    }, delay);
  }

  /**
   * Executa o job de auditoria completo.
   * @returns {Promise<object>} relatório
   */
  async run() {
    const runAt    = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    this._queue.log(LOG_LEVEL.INFO, 'daily_audit', `Iniciando auditoria diária (${runAt})`);

    // 1. Verificar integridade da hash chain
    const integrity = this._audit.verifyIntegrity();

    // 2. Verificar âncora de ontem
    const anchorCheck = this._anchor.verifyInAnchor(
      // Pegar o último hash do dia anterior
      this._getLastHashOfDay(yesterday),
      yesterday
    );

    // 3. Verificar eventos não promovidos no Supabase
    let unpromotedCount = -1;
    if (this._supabase) {
      try {
        const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
        const { count } = await this._supabase
          .from('clock_event_logs')
          .select('id', { count: 'exact', head: true })
          .is('promoted_at', null)
          .lt('created_at', cutoff);
        unpromotedCount = count ?? 0;
      } catch { /* best-effort */ }
    }

    // 4. Montar relatório
    const report = {
      date:        runAt,
      period:      yesterday,
      integrity: {
        ok:       integrity.ok,
        checked:  integrity.checked,
        tampered: integrity.tampered,
      },
      anchor: {
        date:       yesterday,
        found:      anchorCheck.found,
        merkleRoot: anchorCheck.merkleRoot ?? null,
      },
      espelho: {
        unpromotedEvents: unpromotedCount,
        ok: unpromotedCount <= 0,
      },
      overall: integrity.ok && anchorCheck.found && unpromotedCount <= 0 ? 'PASS' : 'FAIL',
    };

    this._lastReport = report;

    // 5. Logar resultado
    const level = report.overall === 'PASS' ? LOG_LEVEL.INFO : LOG_LEVEL.ERROR;
    this._queue.log(level, 'daily_audit',
      `Auditoria diária: ${report.overall} — integridade: ${integrity.ok ? 'OK' : 'FALHOU'}, âncora: ${anchorCheck.found ? 'OK' : 'NÃO ENCONTRADA'}`,
      report);

    // 6. Alertar se violação
    if (report.overall === 'FAIL') {
      await this._alerts.dispatch({
        type:    'audit_violation',
        level:   'critical',
        title:   'Violação de auditoria detectada',
        message: [
          !integrity.ok ? `Hash chain: ${integrity.tampered} registro(s) adulterado(s)` : '',
          !anchorCheck.found ? `Âncora de ${yesterday} não encontrada` : '',
          unpromotedCount > 0 ? `${unpromotedCount} evento(s) sem promoção` : '',
        ].filter(Boolean).join('; '),
        context: report,
      });
    }

    // 7. Salvar relatório no Supabase (best-effort)
    if (this._supabase) {
      await this._supabase.from('audit_daily_reports').upsert({
        date:       yesterday,
        report:     report,
        overall:    report.overall,
        created_at: runAt,
      }, { onConflict: 'date' }).catch((err) => {
        console.warn('[DAILY_AUDIT] Falha ao salvar relatório no Supabase:', err);
      });
    }

    console.log(`[DAILY_AUDIT] ${report.overall} — ${runAt}`);
    return report;
  }

  _getLastHashOfDay(date) {
    try {
      const row = this._audit._db.prepare(`
        SELECT integrity_hash FROM audit_trail
        WHERE created_at >= ? AND created_at < ?
        ORDER BY created_at DESC LIMIT 1
      `).get(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`);
      return row?.integrity_hash ?? '';
    } catch (err) {
      console.warn('[DAILY_AUDIT] Falha ao ler hash do dia:', err);
      return '';
    }
  }

  getLastReport() { return this._lastReport; }
}
