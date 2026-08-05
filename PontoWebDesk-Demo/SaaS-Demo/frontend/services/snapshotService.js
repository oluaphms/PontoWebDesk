import { observabilityConsole } from './observabilityConsole.js';
/**
 * Snapshot de segurança diário.
 *
 * Exporta time_records e sync_jobs (pendentes/falhos) para:
 * 1. Arquivo local JSON comprimido (agent/data/snapshots/)
 * 2. Supabase Storage (bucket 'backups', se configurado)
 *
 * RETENÇÃO: 7 snapshots locais (1 semana)
 * TRIGGER: diário às 02:00 (horário local) ou manual via API
 *
 * Variáveis:
 * - SNAPSHOT_BUCKET: nome do bucket Supabase (default: 'backups')
 * - SNAPSHOT_LOCAL_DIR: diretório local (default: agent/data/snapshots)
 * - SNAPSHOT_ENABLED: '0' para desativar (default: '1')
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { resolve, join }                                                from 'node:path';
import { createHash }                                                   from 'node:crypto';
import { LOG_LEVEL }                                                    from './syncQueue.js';

const DEFAULT_LOCAL_DIR  = resolve(process.cwd(), 'agent/data/snapshots');
const DEFAULT_BUCKET     = 'backups';
const MAX_LOCAL_SNAPSHOTS = 7;

export class SnapshotService {
  /**
   * @param {{
   *   supabase: import('@supabase/supabase-js').SupabaseClient,
   *   queue: import('./syncQueue.js').SyncQueue,
   *   rawDb: import('better-sqlite3').Database,
   *   localDir?: string,
   *   bucket?: string,
   * }} opts
   */
  constructor(opts) {
    this._supabase = opts.supabase;
    this._queue    = opts.queue;
    this._rawDb    = opts.rawDb;
    this._localDir = opts.localDir ?? (process.env.SNAPSHOT_LOCAL_DIR || DEFAULT_LOCAL_DIR);
    this._bucket   = opts.bucket   ?? (process.env.SNAPSHOT_BUCKET    || DEFAULT_BUCKET);
    this._timer    = null;
  }

  start() {
    if (process.env.SNAPSHOT_ENABLED === '0') return this;
    // Agendar para próxima 02:00 local
    this._scheduleNext();
    this._queue.log(LOG_LEVEL.INFO, 'snapshot', 'Serviço de snapshot iniciado');
    return this;
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  _scheduleNext() {
    const now   = new Date();
    const next  = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    this._timer = setTimeout(() => {
      this.takeSnapshot().catch(e => {
        const msg = e instanceof Error ? e.message : String(e);
        this._queue.log(LOG_LEVEL.ERROR, 'snapshot', `Snapshot falhou: ${msg}`);
      });
      this._scheduleNext();
    }, delay);
  }

  /**
   * Executa snapshot imediato.
   * @returns {Promise<{ localPath: string, remotePath: string|null, sizeBytes: number }>}
   */
  async takeSnapshot() {
    const ts       = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `snapshot-${ts}.json`;

    this._queue.log(LOG_LEVEL.INFO, 'snapshot', `Iniciando snapshot: ${filename}`);

    // Coletar dados locais
    const timeRecords = this._rawDb.prepare(`
      SELECT * FROM time_records ORDER BY p_data_hora DESC LIMIT 50000
    `).all();

    const syncJobs = this._rawDb.prepare(`
      SELECT id, status, attempts, error_type, last_error, created_at, updated_at
      FROM sync_jobs
      WHERE status IN ('pending', 'failed')
      ORDER BY created_at DESC
    `).all();

    const systemLogs = this._rawDb.prepare(`
      SELECT * FROM system_logs
      WHERE level IN ('warn', 'error')
      ORDER BY created_at DESC LIMIT 1000
    `).all();

    const payload = {
      version:     '1.0',
      createdAt:   new Date().toISOString(),
      counts:      { timeRecords: timeRecords.length, syncJobs: syncJobs.length, systemLogs: systemLogs.length },
      timeRecords,
      syncJobs,
      systemLogs,
    };

    const json      = JSON.stringify(payload, null, 2);
    const sizeBytes = Buffer.byteLength(json, 'utf8');
    const checksum  = createHash('sha256').update(json).digest('hex');

    // Salvar localmente
    mkdirSync(this._localDir, { recursive: true });
    const localPath = join(this._localDir, filename);
    writeFileSync(localPath, json, 'utf8');

    // Limpar snapshots antigos
    this._pruneLocalSnapshots();

    // Upload para Supabase Storage (best-effort)
    let remotePath = null;
    try {
      const remoteName = `agent-snapshots/${filename}`;
      const { error } = await this._supabase.storage
        .from(this._bucket)
        .upload(remoteName, json, { contentType: 'application/json', upsert: true });

      if (!error) {
        remotePath = remoteName;
        this._queue.log(LOG_LEVEL.INFO, 'snapshot',
          `Snapshot enviado para storage: ${remoteName}`,
          { sizeBytes, checksum });
      } else {
        this._queue.log(LOG_LEVEL.WARN, 'snapshot',
          `Upload para storage falhou (snapshot local salvo): ${error.message}`,
          { localPath });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._queue.log(LOG_LEVEL.WARN, 'snapshot', `Exceção no upload: ${msg}`, { localPath });
    }

    this._queue.log(LOG_LEVEL.INFO, 'snapshot',
      `Snapshot concluído: ${timeRecords.length} registros, ${sizeBytes} bytes`,
      { filename, sizeBytes, checksum, localPath, remotePath });

    observabilityConsole.log(`[SNAPSHOT] ✓ ${filename} — ${timeRecords.length} registros, ${(sizeBytes / 1024).toFixed(1)}KB`);

    return { localPath, remotePath, sizeBytes };
  }

  _pruneLocalSnapshots() {
    try {
      const files = readdirSync(this._localDir)
        .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
        .map(f => ({ name: f, mtime: statSync(join(this._localDir, f)).mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const file of files.slice(MAX_LOCAL_SNAPSHOTS)) {
        unlinkSync(join(this._localDir, file.name));
        this._queue.log(LOG_LEVEL.INFO, 'snapshot', `Snapshot antigo removido: ${file.name}`);
      }
    } catch {
      /* best-effort */
    }
  }
}
