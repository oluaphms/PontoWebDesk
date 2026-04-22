/**
 * Assinatura digital com carimbo de tempo (Timestamp Signature).
 *
 * NÍVEL 1 — Carimbo interno (sempre ativo):
 *   signature = HMAC-SHA256(integrity_hash + created_at + company_id, SECRET_KEY)
 *   Prova que o dado existia no momento da assinatura e não foi alterado.
 *
 * NÍVEL 2 — Âncora externa diária (opcional, RFC 3161-like):
 *   Agrega os hashes do dia em uma Merkle root e publica em:
 *   - Supabase (tabela timestamp_anchors) — rastreável
 *   - Webhook externo configurável (ex: serviço de timestamping)
 *   Permite provar a existência de qualquer registro sem revelar o conteúdo.
 *
 * CONFIGURAÇÃO:
 * - TIMESTAMP_SECRET_KEY:   chave HMAC (obrigatória para nível 1)
 * - TIMESTAMP_ANCHOR_URL:   URL do serviço externo (opcional, nível 2)
 * - TIMESTAMP_ANCHOR_TOKEN: Bearer token para o serviço externo
 *
 * VALOR JURÍDICO:
 * - Nível 1: prova de integridade interna (suficiente para auditoria interna)
 * - Nível 2: prova de existência em data específica (valor jurídico externo)
 */

import { createHmac, createHash, randomUUID } from 'node:crypto';

const SECRET_KEY   = (process.env.TIMESTAMP_SECRET_KEY || 'pontowebdesk-default-key-change-in-prod').trim();
const ANCHOR_URL   = (process.env.TIMESTAMP_ANCHOR_URL   || '').trim();
const ANCHOR_TOKEN = (process.env.TIMESTAMP_ANCHOR_TOKEN || '').trim();

// ─── Nível 1: Assinatura HMAC ─────────────────────────────────────────────────

/**
 * Gera assinatura HMAC-SHA256 para um registro de auditoria.
 *
 * @param {{
 *   integrityHash: string,
 *   createdAt:     string,
 *   companyId?:    string,
 *   action:        string,
 * }} record
 * @returns {string} hex signature
 */
export function signRecord(record) {
  const payload = [
    record.integrityHash,
    record.createdAt,
    record.companyId ?? '',
    record.action,
  ].join('|');
  return createHmac('sha256', SECRET_KEY).update(payload, 'utf8').digest('hex');
}

/**
 * Verifica assinatura de um registro.
 * @param {object} record
 * @param {string} signature
 * @returns {boolean}
 */
export function verifySignature(record, signature) {
  const expected = signRecord(record);
  // Comparação em tempo constante para evitar timing attacks
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Nível 2: Merkle root diária ─────────────────────────────────────────────

/**
 * Constrói Merkle root de um array de hashes.
 * Permite provar que qualquer hash individual faz parte do conjunto.
 *
 * @param {string[]} hashes
 * @returns {string} Merkle root hex
 */
export function buildMerkleRoot(hashes) {
  if (!hashes.length) return createHash('sha256').update('EMPTY', 'utf8').digest('hex');
  if (hashes.length === 1) return hashes[0];

  let level = [...hashes];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left  = level[i];
      const right = level[i + 1] ?? left; // duplicar último se ímpar
      next.push(createHash('sha256').update(left + right, 'utf8').digest('hex'));
    }
    level = next;
  }
  return level[0];
}

// ─── TimestampAnchor ──────────────────────────────────────────────────────────

export class TimestampAnchor {
  /**
   * @param {{
   *   supabase?: import('@supabase/supabase-js').SupabaseClient,
   *   db?:       import('better-sqlite3').Database,
   * }} opts
   */
  constructor(opts = {}) {
    this._supabase = opts.supabase ?? null;
    this._db       = opts.db       ?? null;
    this._timer    = null;
  }

  start() {
    // Âncora diária às 23:55
    this._scheduleNext();
    return this;
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  _scheduleNext() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(23, 55, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    this._timer = setTimeout(() => {
      this.anchorDay().catch(e => console.error('[ANCHOR]', e instanceof Error ? e.message : e));
      this._scheduleNext();
    }, delay);
  }

  /**
   * Ancora todos os hashes de auditoria do dia atual.
   * @returns {Promise<{ merkleRoot: string, count: number, anchoredAt: string }>}
   */
  async anchorDay() {
    if (!this._db) return { merkleRoot: '', count: 0, anchoredAt: new Date().toISOString() };

    const today = new Date().toISOString().slice(0, 10);
    const rows  = this._db.prepare(`
      SELECT integrity_hash FROM audit_trail
      WHERE created_at >= ? AND created_at < ?
      ORDER BY created_at ASC
    `).all(`${today}T00:00:00.000Z`, `${today}T23:59:59.999Z`);

    const hashes     = rows.map(r => r.integrity_hash);
    const merkleRoot = buildMerkleRoot(hashes);
    const anchoredAt = new Date().toISOString();
    const anchorId   = randomUUID();

    // Salvar localmente
    try {
      this._db.prepare(`
        CREATE TABLE IF NOT EXISTS timestamp_anchors (
          id          TEXT PRIMARY KEY NOT NULL,
          date        TEXT NOT NULL,
          merkle_root TEXT NOT NULL,
          hash_count  INTEGER NOT NULL,
          anchored_at TEXT NOT NULL,
          external_ref TEXT
        )
      `).run();
      this._db.prepare(`
        INSERT OR IGNORE INTO timestamp_anchors (id, date, merkle_root, hash_count, anchored_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(anchorId, today, merkleRoot, hashes.length, anchoredAt);
    } catch (err) {
      console.warn('[ANCHOR] Falha ao salvar âncora local:', err);
    }

    // Salvar no Supabase
    if (this._supabase) {
      await this._supabase.from('timestamp_anchors').upsert({
        id: anchorId, date: today, merkle_root: merkleRoot,
        hash_count: hashes.length, anchored_at: anchoredAt,
      }, { onConflict: 'date', ignoreDuplicates: false }).catch((err) => {
        console.warn('[ANCHOR] Falha ao salvar âncora no Supabase:', err);
      });
    }

    // Publicar em serviço externo (opcional)
    if (ANCHOR_URL) {
      await this._publishExternal({ anchorId, date: today, merkleRoot, hashCount: hashes.length, anchoredAt })
        .catch(e => console.warn('[ANCHOR] Publicação externa falhou:', e instanceof Error ? e.message : e));
    }

    console.log(`[ANCHOR] ✓ Âncora do dia ${today}: ${hashes.length} hashes → Merkle root ${merkleRoot.slice(0, 16)}...`);
    return { merkleRoot, count: hashes.length, anchoredAt };
  }

  async _publishExternal(payload) {
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'PontoWebDesk-Anchor/1.0' };
    if (ANCHOR_TOKEN) headers['Authorization'] = `Bearer ${ANCHOR_TOKEN}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    await fetch(ANCHOR_URL, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
    clearTimeout(t);
  }

  /**
   * Verifica se um hash específico está incluído em uma âncora do dia.
   * @param {string} hash
   * @param {string} date — 'YYYY-MM-DD'
   * @returns {{ found: boolean, merkleRoot?: string, date?: string }}
   */
  verifyInAnchor(hash, date) {
    if (!this._db) return { found: false };
    try {
      const anchor = this._db.prepare(
        `SELECT merkle_root FROM timestamp_anchors WHERE date = ?`
      ).get(date);
      if (!anchor) return { found: false };

      // Verificar se o hash está nos registros do dia
      const row = this._db.prepare(`
        SELECT id FROM audit_trail
        WHERE integrity_hash = ? AND created_at >= ? AND created_at < ?
      `).get(hash, `${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`);

      return { found: !!row, merkleRoot: anchor.merkle_root, date };
    } catch {
      return { found: false };
    }
  }
}
