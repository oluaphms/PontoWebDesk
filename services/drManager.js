/**
 * Disaster Recovery Manager.
 *
 * OBJETIVOS:
 * - RPO ≤ 5 minutos: backup incremental contínuo via WAL
 * - RTO ≤ 30 minutos: restore automatizado com validação
 *
 * ESTRATÉGIA:
 * 1. WAL checkpoint periódico (a cada 5 min) → copia WAL para backup
 * 2. Snapshot completo diário (já implementado em snapshotService.js)
 * 3. Teste de restore mensal automatizado
 * 4. Validação pós-restore: verifica contagem de registros
 *
 * ARMAZENAMENTO:
 * - Local: agent/data/dr/ (WAL checkpoints)
 * - Remoto: Supabase Storage bucket 'dr-backups'
 *
 * CONFIGURAÇÃO:
 * - DR_ENABLED:          '1' para ativar (default: '1')
 * - DR_CHECKPOINT_MS:    intervalo de checkpoint em ms (default: 5 min)
 * - DR_BUCKET:           bucket Supabase para backups DR (default: 'dr-backups')
 * - DR_LOCAL_DIR:        diretório local para WAL (default: agent/data/dr)
 */

import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join }                                                            from 'node:path';
import { createHash }                                                               from 'node:crypto';
import { LOG_LEVEL }                                                                from './syncQueue.js';

const DR_ENABLED       = (process.env.DR_ENABLED       || '1').trim() !== '0';
const CHECKPOINT_MS    = parseInt(process.env.DR_CHECKPOINT_MS || String(5 * 60_000), 10);
const DR_BUCKET        = (process.env.DR_BUCKET        || 'dr-backups').trim();
const DR_LOCAL_DIR     = (process.env.DR_LOCAL_DIR     || resolve(process.cwd(), 'agent/data/dr')).trim();
const MAX_LOCAL_WAL    = 12; // manter últimos 12 checkpoints (1 hora)

export class DRManager {
  /**
   * @param {{
   *   sqliteDbPath: string,
   *   rawDb:        import('better-sqlite3').Database,
   *   supabase?:    import('@supabase/supabase-js').SupabaseClient,
   *   queue:        import('./syncQueue.js').SyncQueue,
   * }} opts
   */
  constructor(opts) {
    this._dbPath   = opts.sqliteDbPath;
    this._rawDb    = opts.rawDb;
    this._supabase = opts.supabase ?? null;
    this._queue    = opts.queue;
    this._timer    = null;
    this._lastRPO  = null;
  }

  start() {
    if (!DR_ENABLED) return this;
    mkdirSync(DR_LOCAL_DIR, { recursive: true });
    // Primeiro checkpoint imediato
    void this._checkpoint().catch((err) => {
      this._queue.log(LOG_LEVEL.WARN, 'dr', 'Checkpoint inicial falhou', { error: String(err) });
    });
    this._timer = setInterval(
      () =>
        this._checkpoint().catch((err) => {
          this._queue.log(LOG_LEVEL.WARN, 'dr', 'Checkpoint periódico falhou', { error: String(err) });
        }),
      CHECKPOINT_MS
    );
    // Teste de restore mensal (1º do mês às 04:00)
    this._scheduleRestoreTest();
    this._queue.log(LOG_LEVEL.INFO, 'dr', `DR Manager iniciado (checkpoint: ${CHECKPOINT_MS / 1000}s, RPO alvo: 5min)`);
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // ── WAL Checkpoint ────────────────────────────────────────────────────────

  async _checkpoint() {
    const ts       = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `wal-checkpoint-${ts}.db`;
    const localPath = join(DR_LOCAL_DIR, filename);

    try {
      // Forçar WAL checkpoint no SQLite
      this._rawDb.pragma('wal_checkpoint(TRUNCATE)');

      // Copiar arquivo do banco
      copyFileSync(this._dbPath, localPath);

      // Calcular checksum
      const { readFileSync } = await import('node:fs');
      const content  = readFileSync(localPath);
      const checksum = createHash('sha256').update(content).digest('hex');
      const sizeKb   = Math.round(content.length / 1024);

      this._lastRPO = new Date().toISOString();

      // Upload para Supabase Storage (best-effort)
      if (this._supabase) {
        await this._supabase.storage
          .from(DR_BUCKET)
          .upload(`wal/${filename}`, content, { contentType: 'application/octet-stream', upsert: true })
          .catch((err) => {
            this._queue.log(LOG_LEVEL.WARN, 'dr', 'Upload do checkpoint falhou', { error: String(err) });
          });
      }

      // Limpar checkpoints antigos
      this._pruneLocalCheckpoints();

      this._queue.log(LOG_LEVEL.INFO, 'dr',
        `WAL checkpoint: ${filename} (${sizeKb}KB, checksum: ${checksum.slice(0, 16)}...)`,
        { filename, sizeKb, checksum, rpo: this._lastRPO });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._queue.log(LOG_LEVEL.ERROR, 'dr', `Checkpoint falhou: ${msg}`, { error: msg });
    }
  }

  _pruneLocalCheckpoints() {
    try {
      const files = readdirSync(DR_LOCAL_DIR)
        .filter(f => f.startsWith('wal-checkpoint-') && f.endsWith('.db'))
        .map(f => ({ name: f, mtime: statSync(join(DR_LOCAL_DIR, f)).mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const file of files.slice(MAX_LOCAL_WAL)) {
        unlinkSync(join(DR_LOCAL_DIR, file.name));
      }
    } catch { /* best-effort */ }
  }

  // ── Restore Test ──────────────────────────────────────────────────────────

  _scheduleRestoreTest() {
    const now  = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 4, 0, 0, 0);
    const delay = next.getTime() - now.getTime();
    setTimeout(() => {
      this.runRestoreTest().catch(e => {
        const msg = e instanceof Error ? e.message : String(e);
        this._queue.log(LOG_LEVEL.ERROR, 'dr', `Teste de restore falhou: ${msg}`);
      });
      this._scheduleRestoreTest();
    }, delay);
  }

  /**
   * Executa teste de restore: verifica se o último checkpoint é válido.
   * @returns {Promise<{ ok: boolean, recordCount: number, checksum: string }>}
   */
  async runRestoreTest() {
    this._queue.log(LOG_LEVEL.INFO, 'dr', 'Iniciando teste de restore mensal...');

    // Encontrar checkpoint mais recente
    const files = readdirSync(DR_LOCAL_DIR)
      .filter(f => f.startsWith('wal-checkpoint-') && f.endsWith('.db'))
      .sort()
      .reverse();

    if (!files.length) {
      this._queue.log(LOG_LEVEL.WARN, 'dr', 'Nenhum checkpoint disponível para teste de restore');
      return { ok: false, recordCount: 0, checksum: '' };
    }

    const latestPath = join(DR_LOCAL_DIR, files[0]);

    try {
      const { default: Database } = await import('better-sqlite3');
      const testDb = new Database(latestPath, { readonly: true });

      const count = testDb.prepare(`SELECT COUNT(*) as c FROM time_records`).get()?.c ?? 0;
      const { readFileSync } = await import('node:fs');
      const checksum = createHash('sha256').update(readFileSync(latestPath)).digest('hex');

      testDb.close();

      const result = { ok: count > 0, recordCount: count, checksum: checksum.slice(0, 16) };
      this._queue.log(LOG_LEVEL.INFO, 'dr',
        `Teste de restore: ${result.ok ? 'OK' : 'FALHOU'} — ${count} registros`,
        result);

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._queue.log(LOG_LEVEL.ERROR, 'dr', `Erro no teste de restore: ${msg}`);
      return { ok: false, recordCount: 0, checksum: '' };
    }
  }

  getStatus() {
    const files = existsSync(DR_LOCAL_DIR)
      ? readdirSync(DR_LOCAL_DIR).filter(f => f.endsWith('.db')).length
      : 0;
    return {
      enabled:       DR_ENABLED,
      lastRPO:       this._lastRPO,
      checkpointMs:  CHECKPOINT_MS,
      localFiles:    files,
      rpoTarget:     '5 minutes',
      rtoTarget:     '30 minutes',
    };
  }
}
