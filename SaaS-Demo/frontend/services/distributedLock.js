/**
 * Lock distribuído via Supabase (multi-instância).
 *
 * Garante que apenas um worker processa a fila por vez, mesmo com múltiplos
 * agentes rodando em paralelo (ex.: dois servidores on-premise).
 *
 * ESTRATÉGIA:
 * - Tabela `distributed_locks` no Supabase com UPDATE condicional atômico.
 * - Se `locked_until IS NULL OR locked_until < now()` → adquire o lock.
 * - Se rowsAffected = 0 → outro worker tem o lock → pula o ciclo.
 * - TTL padrão: 60s (lock expira automaticamente se o processo morrer).
 *
 * FALLBACK:
 * - Se o Supabase estiver fora, usa lock local (SQLite) como fallback.
 * - Isso garante operação offline sem travar o worker.
 *
 * SQL para criar a tabela no Supabase (executar uma vez):
 * ─────────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS distributed_locks (
 *   name         TEXT PRIMARY KEY NOT NULL,
 *   locked_by    TEXT,
 *   locked_until TIMESTAMPTZ
 * );
 * INSERT INTO distributed_locks (name) VALUES ('sync_worker') ON CONFLICT DO NOTHING;
 * ─────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

/** Identificador único desta instância do worker (gerado uma vez por processo). */
const INSTANCE_ID = randomUUID();

export class DistributedLock {
  /**
   * @param {{
   *   supabase: import('@supabase/supabase-js').SupabaseClient,
   *   localQueue: import('./syncQueue.js').SyncQueue,
   *   ttlMs?: number,
   * }} opts
   */
  constructor(opts) {
    this._supabase  = opts.supabase;
    this._local     = opts.localQueue;
    this._ttlMs     = opts.ttlMs ?? 60_000;
    this._heldLocks = new Set(); // locks atualmente mantidos por esta instância
  }

  /**
   * Tenta adquirir o lock distribuído.
   * Retorna true se adquiriu, false se outro worker tem o lock.
   *
   * @param {string} name
   * @returns {Promise<boolean>}
   */
  async acquire(name) {
    const now        = new Date();
    const lockedUntil = new Date(now.getTime() + this._ttlMs).toISOString();

    try {
      // UPDATE condicional: só atualiza se o lock estiver livre ou expirado
      const { data, error } = await this._supabase
        .from('distributed_locks')
        .update({ locked_by: INSTANCE_ID, locked_until: lockedUntil })
        .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
        .eq('name', name)
        .select('name');

      if (error) {
        // Supabase fora → fallback para lock local
        this._local.log('warn', 'dist_lock', `Fallback para lock local (Supabase indisponível): ${error.message}`, { name });
        return this._local.acquireLock(name, this._ttlMs);
      }

      const acquired = Array.isArray(data) && data.length > 0;
      if (acquired) this._heldLocks.add(name);
      return acquired;

    } catch (err) {
      // Fallback para lock local
      const msg = err instanceof Error ? err.message : String(err);
      this._local.log('warn', 'dist_lock', `Fallback para lock local (exceção): ${msg}`, { name });
      return this._local.acquireLock(name, this._ttlMs);
    }
  }

  /**
   * Libera o lock distribuído.
   * @param {string} name
   */
  async release(name) {
    this._heldLocks.delete(name);

    try {
      await this._supabase
        .from('distributed_locks')
        .update({ locked_by: null, locked_until: null })
        .eq('name', name)
        .eq('locked_by', INSTANCE_ID);
    } catch {
      /* Falha silenciosa — o TTL vai expirar naturalmente */
    }

    // Liberar também o lock local (fallback)
    this._local.releaseLock(name);
  }

  /**
   * Renova o TTL do lock (heartbeat) para ciclos longos.
   * @param {string} name
   */
  async renew(name) {
    if (!this._heldLocks.has(name)) return;
    const lockedUntil = new Date(Date.now() + this._ttlMs).toISOString();
    try {
      await this._supabase
        .from('distributed_locks')
        .update({ locked_until: lockedUntil })
        .eq('name', name)
        .eq('locked_by', INSTANCE_ID);
    } catch {
      /* Falha silenciosa */
    }
  }

  get instanceId() { return INSTANCE_ID; }
}
