/**
 * Trilha de auditoria imutável.
 *
 * Registra toda ação relevante com before/after, actor e timestamp.
 * Gravada em duas camadas:
 * 1. SQLite local (audit_trail) — disponível offline, imediato
 * 2. Supabase (audit_trail) — persistência cloud, consultável
 *
 * IMUTABILIDADE:
 * - Nunca há UPDATE ou DELETE nesta tabela
 * - Cada registro tem integrity_hash encadeado (SHA-256 do anterior + dados)
 * - Permite detecção de adulteração da trilha
 *
 * AÇÕES REGISTRADAS:
 * - PUNCH_INSERTED       batida inserida pelo agente/API
 * - PUNCH_MANUAL_EDIT    alteração manual de batida
 * - PUNCH_REPROCESSED    reprocessamento via DLQ
 * - PUNCH_REJECTED       batida rejeitada pela validação
 * - SYNC_COMPLETED       ciclo de sync concluído
 * - SNAPSHOT_TAKEN       snapshot de segurança gerado
 * - RECONCILE_RUN        reconciliação automática executada
 * - SCHEMA_MIGRATED      migração de schema aplicada
 */

import { createHash, randomUUID } from 'node:crypto';
import { LOG_LEVEL }              from './syncQueue.js';
import { signRecord }             from './timestampSigner.js';

export const AUDIT_ACTION = /** @type {const} */ ({
  PUNCH_INSERTED:    'PUNCH_INSERTED',
  PUNCH_MANUAL_EDIT: 'PUNCH_MANUAL_EDIT',
  PUNCH_REPROCESSED: 'PUNCH_REPROCESSED',
  PUNCH_REJECTED:    'PUNCH_REJECTED',
  SYNC_COMPLETED:    'SYNC_COMPLETED',
  SNAPSHOT_TAKEN:    'SNAPSHOT_TAKEN',
  RECONCILE_RUN:     'RECONCILE_RUN',
  SCHEMA_MIGRATED:   'SCHEMA_MIGRATED',
  DLQ_REQUEUED:      'DLQ_REQUEUED',
});

// ─── Schema SQLite local ───────────────────────────────────────────────────────

const AUDIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_trail (
  id              TEXT PRIMARY KEY NOT NULL,
  entity          TEXT NOT NULL,
  entity_id       TEXT,
  action          TEXT NOT NULL,
  before_data     TEXT,          -- JSON snapshot antes da ação
  after_data      TEXT,          -- JSON snapshot após a ação
  performed_by    TEXT,          -- actor: 'agent', 'api', 'admin', user_id
  company_id      TEXT,
  integrity_hash  TEXT NOT NULL, -- SHA-256 encadeado
  signature       TEXT,          -- HMAC-SHA256 (carimbo de tempo)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity    ON audit_trail (entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_company   ON audit_trail (company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_trail (action, created_at);
`;

// ─── AuditTrail ────────────────────────────────────────────────────────────────

export class AuditTrail {
  /**
   * @param {{
   *   db: import('better-sqlite3').Database,
   *   supabase?: import('@supabase/supabase-js').SupabaseClient,
   *   queue?: import('./syncQueue.js').SyncQueue,
   *   tableName?: string,
   * }} opts
   */
  constructor(opts) {
    this._db        = opts.db;
    this._supabase  = opts.supabase ?? null;
    this._queue     = opts.queue    ?? null;
    this._table     = opts.tableName ?? 'audit_trail';
    this._lastHash  = null; // hash do último registro (para encadeamento)
    this._ensureSchema();
    this._loadLastHash();
  }

  _ensureSchema() {
    try { this._db.exec(AUDIT_SCHEMA); } catch { /* ignore */ }
  }

  _loadLastHash() {
    try {
      const row = this._db.prepare(
        `SELECT integrity_hash FROM audit_trail ORDER BY created_at DESC LIMIT 1`
      ).get();
      this._lastHash = row?.integrity_hash ?? 'GENESIS';
    } catch {
      this._lastHash = 'GENESIS';
    }
  }

  /**
   * Calcula hash encadeado: SHA-256(previousHash + JSON(data))
   * @param {object} data
   * @returns {string}
   */
  _computeHash(data) {
    const content = (this._lastHash ?? 'GENESIS') + JSON.stringify(data);
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Registra uma entrada na trilha de auditoria.
   *
   * @param {{
   *   entity:      string,
   *   entityId?:   string,
   *   action:      string,
   *   before?:     object,
   *   after?:      object,
   *   performedBy?: string,
   *   companyId?:  string,
   * }} entry
   * @returns {string} id do registro criado
   */
  record(entry) {
    const id        = randomUUID();
    const now       = new Date().toISOString();
    const data      = { id, ...entry, created_at: now };
    const hash      = this._computeHash(data);
    this._lastHash  = hash;

    // Assinatura HMAC (carimbo de tempo)
    let signature = null;
    try {
      signature = signRecord({ integrityHash: hash, createdAt: now, companyId: entry.companyId, action: entry.action });
    } catch { /* best-effort */ }

    try {
      this._db.prepare(`
        INSERT INTO audit_trail
          (id, entity, entity_id, action, before_data, after_data, performed_by, company_id, integrity_hash, signature, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        entry.entity,
        entry.entityId ?? null,
        entry.action,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after  ? JSON.stringify(entry.after)  : null,
        entry.performedBy ?? 'agent',
        entry.companyId   ?? null,
        hash,
        signature,
        now,
      );
    } catch (err) {
      console.error('[AUDIT] Falha ao gravar localmente:', err instanceof Error ? err.message : err);
    }

    // Replicar para Supabase de forma assíncrona (best-effort)
    if (this._supabase) {
      this._replicateToCloud(id, entry, hash, now).catch((err) => {
        console.warn('[AUDIT] Falha ao replicar para cloud:', err instanceof Error ? err.message : err);
      });
    }

    return id;
  }

  async _replicateToCloud(id, entry, hash, now) {
    try {
      const sig = (() => { try { return signRecord({ integrityHash: hash, createdAt: now, companyId: entry.companyId, action: entry.action }); } catch { return null; } })();
      await this._supabase.from(this._table).upsert({
        id,
        entity:         entry.entity,
        entity_id:      entry.entityId ?? null,
        action:         entry.action,
        before_data:    entry.before ?? null,
        after_data:     entry.after  ?? null,
        performed_by:   entry.performedBy ?? 'agent',
        company_id:     entry.companyId   ?? null,
        integrity_hash: hash,
        signature:      sig,
        created_at:     now,
      }, { onConflict: 'id', ignoreDuplicates: true });
    } catch {
      /* best-effort — o registro local já existe */
    }
  }

  /**
   * Verifica integridade da trilha local (detecta adulteração).
   * Recalcula todos os hashes e compara com os armazenados.
   *
   * @returns {{ ok: boolean, tampered: number, checked: number }}
   */
  verifyIntegrity() {
    const rows = this._db.prepare(
      `SELECT id, entity, entity_id, action, before_data, after_data,
              performed_by, company_id, integrity_hash, created_at
       FROM audit_trail ORDER BY created_at ASC`
    ).all();

    let prevHash = 'GENESIS';
    let tampered = 0;

    for (const row of rows) {
      const data = {
        id:           row.id,
        entity:       row.entity,
        entityId:     row.entity_id,
        action:       row.action,
        before:       row.before_data ? JSON.parse(row.before_data) : undefined,
        after:        row.after_data  ? JSON.parse(row.after_data)  : undefined,
        performedBy:  row.performed_by,
        companyId:    row.company_id,
        created_at:   row.created_at,
      };
      const content  = prevHash + JSON.stringify(data);
      const expected = createHash('sha256').update(content, 'utf8').digest('hex');

      if (expected !== row.integrity_hash) tampered++;
      prevHash = row.integrity_hash;
    }

    return { ok: tampered === 0, tampered, checked: rows.length };
  }

  /**
   * Retorna entradas recentes da trilha.
   * @param {{ entity?: string, companyId?: string, action?: string, limit?: number }} opts
   */
  query(opts = {}) {
    const { entity, companyId, action, limit = 100 } = opts;
    let sql = `SELECT * FROM audit_trail`;
    const params = [];
    const where  = [];
    if (entity)    { where.push(`entity = ?`);     params.push(entity); }
    if (companyId) { where.push(`company_id = ?`); params.push(companyId); }
    if (action)    { where.push(`action = ?`);     params.push(action); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    return this._db.prepare(sql).all(...params).map(r => ({
      id:            r.id,
      entity:        r.entity,
      entityId:      r.entity_id,
      action:        r.action,
      before:        r.before_data ? (() => { try { return JSON.parse(r.before_data); } catch { return null; } })() : null,
      after:         r.after_data  ? (() => { try { return JSON.parse(r.after_data);  } catch { return null; } })() : null,
      performedBy:   r.performed_by,
      companyId:     r.company_id,
      integrityHash: r.integrity_hash,
      signature:     r.signature ?? null,
      createdAt:     r.created_at,
    }));
  }
}
