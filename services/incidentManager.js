/**
 * Incident Manager — registro e gestão de incidentes operacionais.
 *
 * PADRÃO: INCIDENT-YYYYMMDD-NNN
 *
 * CICLO DE VIDA:
 * - OPEN:       incidente detectado
 * - MITIGATED:  impacto reduzido, causa raiz em investigação
 * - RESOLVED:   causa raiz corrigida
 * - POSTMORTEM: post-mortem gerado
 *
 * SEVERIDADES:
 * - P1 (Critical): sistema fora, perda de dados
 * - P2 (High):     degradação severa, SLO violado
 * - P3 (Medium):   degradação parcial, workaround disponível
 * - P4 (Low):      impacto mínimo, monitorando
 *
 * POST-MORTEM AUTOMÁTICO:
 * - Gerado ao resolver incidente P1/P2
 * - Salvo em docs/incidents/
 * - Inclui: timeline, causa raiz, impacto, ações corretivas
 */

import { randomUUID }  from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join }            from 'node:path';
import { LOG_LEVEL }                from './syncQueue.js';

export const SEVERITY = { P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4' };
export const STATUS   = { OPEN: 'OPEN', MITIGATED: 'MITIGATED', RESOLVED: 'RESOLVED', POSTMORTEM: 'POSTMORTEM' };

const INCIDENTS_DIR = resolve(process.cwd(), 'docs/incidents');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS incidents (
  id           TEXT PRIMARY KEY NOT NULL,
  title        TEXT NOT NULL,
  severity     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'OPEN',
  cause        TEXT,
  impact       TEXT,
  mitigation   TEXT,
  resolution   TEXT,
  affected_tenants TEXT,
  opened_at    TEXT NOT NULL,
  mitigated_at TEXT,
  resolved_at  TEXT,
  postmortem_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status, opened_at);
`;

export class IncidentManager {
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
    try { this._db.exec(SCHEMA); } catch { /* ignore */ }
    mkdirSync(INCIDENTS_DIR, { recursive: true });
  }

  // ── Geração de ID ─────────────────────────────────────────────────────────

  _generateId() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq  = this._db.prepare(
      `SELECT COUNT(*) as c FROM incidents WHERE id LIKE ?`
    ).get(`INCIDENT-${date}-%`)?.c ?? 0;
    return `INCIDENT-${date}-${String(seq + 1).padStart(3, '0')}`;
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /**
   * Abre um novo incidente.
   * @param {{ title: string, severity: string, cause?: string, impact?: string, affectedTenants?: string[] }} params
   * @returns {string} id do incidente
   */
  open(params) {
    const id  = this._generateId();
    const now = new Date().toISOString();

    this._db.prepare(`
      INSERT INTO incidents (id, title, severity, status, cause, impact, affected_tenants, opened_at)
      VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?)
    `).run(
      id, params.title, params.severity,
      params.cause ?? null,
      params.impact ?? null,
      params.affectedTenants ? JSON.stringify(params.affectedTenants) : null,
      now
    );

    this._queue.log(LOG_LEVEL.ERROR, 'incident',
      `[${id}] ABERTO (${params.severity}): ${params.title}`,
      { id, severity: params.severity, cause: params.cause, impact: params.impact });

    if (this._alerts && (params.severity === SEVERITY.P1 || params.severity === SEVERITY.P2)) {
      this._alerts.dispatch({
        type:    `incident_${params.severity.toLowerCase()}`,
        level:   params.severity === SEVERITY.P1 ? 'critical' : 'error',
        title:   `[${id}] ${params.severity}: ${params.title}`,
        message: params.impact ?? params.cause ?? 'Incidente aberto',
        context: { id, severity: params.severity, affectedTenants: params.affectedTenants },
      }).catch((err) => {
        this._queue.log(LOG_LEVEL.WARN, 'incident', 'Falha ao disparar alerta de incidente', { error: String(err) });
      });
    }

    return id;
  }

  /**
   * Atualiza status do incidente.
   * @param {string} id
   * @param {{ status: string, mitigation?: string, resolution?: string, cause?: string }} update
   */
  update(id, update) {
    const now = new Date().toISOString();
    const fields = [];
    const values = [];

    if (update.status) { fields.push('status = ?'); values.push(update.status); }
    if (update.mitigation) { fields.push('mitigation = ?'); values.push(update.mitigation); }
    if (update.resolution) { fields.push('resolution = ?'); values.push(update.resolution); }
    if (update.cause) { fields.push('cause = ?'); values.push(update.cause); }
    if (update.status === STATUS.MITIGATED) { fields.push('mitigated_at = ?'); values.push(now); }
    if (update.status === STATUS.RESOLVED)  { fields.push('resolved_at = ?');  values.push(now); }

    if (!fields.length) return;
    values.push(id);
    this._db.prepare(`UPDATE incidents SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    this._queue.log(LOG_LEVEL.INFO, 'incident',
      `[${id}] ${update.status ?? 'ATUALIZADO'}: ${update.mitigation ?? update.resolution ?? ''}`,
      { id, ...update });

    // Gerar post-mortem automático ao resolver P1/P2
    if (update.status === STATUS.RESOLVED) {
      const incident = this.get(id);
      if (incident && (incident.severity === SEVERITY.P1 || incident.severity === SEVERITY.P2)) {
        this._generatePostMortem(incident);
      }
    }
  }

  /**
   * Retorna um incidente pelo ID.
   * @param {string} id
   */
  get(id) {
    const r = this._db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(id);
    if (!r) return null;
    return this._parseRow(r);
  }

  /**
   * Lista incidentes.
   * @param {{ status?: string, severity?: string, limit?: number }} opts
   */
  list(opts = {}) {
    const { status, severity, limit = 50 } = opts;
    let sql = `SELECT * FROM incidents`;
    const params = [];
    const where  = [];
    if (status)   { where.push(`status = ?`);   params.push(status); }
    if (severity) { where.push(`severity = ?`); params.push(severity); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY opened_at DESC LIMIT ?`;
    params.push(limit);
    return this._db.prepare(sql).all(...params).map(r => this._parseRow(r));
  }

  _parseRow(r) {
    return {
      id:               r.id,
      title:            r.title,
      severity:         r.severity,
      status:           r.status,
      cause:            r.cause,
      impact:           r.impact,
      mitigation:       r.mitigation,
      resolution:       r.resolution,
      affectedTenants:  r.affected_tenants ? (() => { try { return JSON.parse(r.affected_tenants); } catch { return []; } })() : [],
      openedAt:         r.opened_at,
      mitigatedAt:      r.mitigated_at,
      resolvedAt:       r.resolved_at,
      postmortemPath:   r.postmortem_path,
      durationMinutes:  r.resolved_at
        ? Math.round((new Date(r.resolved_at) - new Date(r.opened_at)) / 60_000)
        : Math.round((Date.now() - new Date(r.opened_at).getTime()) / 60_000),
    };
  }

  // ── Post-Mortem ───────────────────────────────────────────────────────────

  _generatePostMortem(incident) {
    const filename = `${incident.id}.md`;
    const path     = join(INCIDENTS_DIR, filename);
    const duration = incident.durationMinutes;

    const content = `# Post-Mortem: ${incident.id}

**Severidade:** ${incident.severity}  
**Status:** ${incident.status}  
**Duração:** ${duration} minutos  
**Aberto em:** ${incident.openedAt}  
**Resolvido em:** ${incident.resolvedAt ?? 'N/A'}  

---

## Resumo

${incident.title}

## Impacto

${incident.impact ?? 'Não documentado'}

## Causa Raiz

${incident.cause ?? 'Em investigação'}

## Timeline

| Horário | Evento |
|---------|--------|
| ${incident.openedAt} | Incidente detectado e aberto |
${incident.mitigatedAt ? `| ${incident.mitigatedAt} | Mitigação aplicada |\n` : ''}${incident.resolvedAt ? `| ${incident.resolvedAt} | Incidente resolvido |\n` : ''}

## Mitigação Aplicada

${incident.mitigation ?? 'Não documentada'}

## Resolução

${incident.resolution ?? 'Não documentada'}

## Tenants Afetados

${incident.affectedTenants?.length ? incident.affectedTenants.join(', ') : 'Não identificados'}

## Ações Corretivas

- [ ] Documentar causa raiz detalhada
- [ ] Implementar prevenção (se aplicável)
- [ ] Atualizar runbook correspondente
- [ ] Revisar alertas para detecção mais rápida

## Lições Aprendidas

_A preencher pela equipe após análise._

---

*Gerado automaticamente pelo IncidentManager em ${new Date().toISOString()}*
`;

    try {
      writeFileSync(path, content, 'utf8');
      this._db.prepare(`UPDATE incidents SET postmortem_path = ?, status = 'POSTMORTEM' WHERE id = ?`)
        .run(path, incident.id);
      this._queue.log(LOG_LEVEL.INFO, 'incident',
        `[${incident.id}] Post-mortem gerado: ${path}`, { id: incident.id, path });
      console.log(`[INCIDENT] Post-mortem: ${path}`);
    } catch (err) {
      console.error('[INCIDENT] Falha ao gerar post-mortem:', err instanceof Error ? err.message : err);
    }
  }
}
