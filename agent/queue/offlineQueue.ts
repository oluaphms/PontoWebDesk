/**
 * Fila persistente em SQLite: tabela `pending_punches` (fallback) + `time_records` (pipeline principal).
 *
 * PIPELINE ÚNICO (ARQUITETURA HÍBRIDA CORRIGIDA):
 * - `time_records`: tabela principal. Batidas do relógio são gravadas aqui (synced=0).
 *   O worker `services/syncService.js` lê e envia para `clock_event_logs` no Supabase.
 * - `pending_punches`: tabela de fallback para o modo direto (deferCloud=false).
 *   Quando CLOCK_SYNC_DEFER_CLOUD_TO_WORKER=1 (padrão), esta tabela NÃO é usada.
 *
 * Política de dados: não há DELETE — pendências permanecem até envio bem-sucedido (synced=1).
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { PendingPunchContext, PendingPunchSource, PendingPunchBatch } from './types';
import { nextRetryIsoFromNow } from './retryPolicy';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pending_punches (
  id TEXT PRIMARY KEY NOT NULL,
  employee_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('clock', 'web')),
  synced INTEGER NOT NULL DEFAULT 0 CHECK (synced IN (0, 1)),
  context_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_punches_synced_retry
  ON pending_punches (synced, timestamp);
`;

/** `time_records` local: fonte principal do pipeline único → syncService.js → clock_event_logs. */
const TIME_RECORDS_LOCAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS time_records (
  id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL,
  rep_id TEXT NOT NULL,
  nsr INTEGER,
  p_pis TEXT,
  p_cpf TEXT,
  p_matricula TEXT,
  p_data_hora TEXT NOT NULL,
  p_tipo_marcacao TEXT NOT NULL DEFAULT 'E',
  p_raw_data TEXT,
  synced INTEGER NOT NULL DEFAULT 0 CHECK (synced IN (0, 1)),
  synced_at TEXT,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_sync_error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_records_rep_nsr ON time_records(rep_id, nsr) WHERE nsr IS NOT NULL;
`;

function ensureTimeRecordsColumns(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(time_records)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('sync_attempts')) {
    try {
      db.exec(`ALTER TABLE time_records ADD COLUMN sync_attempts INTEGER NOT NULL DEFAULT 0`);
    } catch (error) {
      void error;
    }
  }
  if (!names.has('last_sync_error')) {
    try {
      db.exec(`ALTER TABLE time_records ADD COLUMN last_sync_error TEXT`);
    } catch (error) {
      void error;
    }
  }
}

function employeeFieldsFromRef(ref: string): { p_pis: string | null; p_cpf: string | null; p_matricula: string | null } {
  const digits = ref.replace(/\D/g, '');
  if (digits.length === 11) return { p_pis: digits, p_cpf: digits, p_matricula: null };
  if (digits.length > 0 && digits.length < 11) return { p_pis: null, p_cpf: null, p_matricula: ref.trim() };
  if (ref.trim()) return { p_pis: null, p_cpf: null, p_matricula: ref.trim() };
  return { p_pis: null, p_cpf: null, p_matricula: null };
}

function eventTypeToTipoMarcacao(eventType: string): string {
  const t = eventType.toLowerCase();
  if (t.startsWith('sai') || t.startsWith('saí')) return 'S';
  if (t.startsWith('ent')) return 'E';
  if (t.startsWith('paus') || t.startsWith('int')) return 'P';
  return 'B';
}

function parseRowString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export class OfflineQueue {
  private readonly dbPath: string;
  private db: Database.Database | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private getDb(): Database.Database {
    if (this.db) return this.db;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const database = new Database(this.dbPath);
    database.pragma('journal_mode = WAL');
    database.exec(SCHEMA);
    database.exec(TIME_RECORDS_LOCAL_SCHEMA);
    ensureTimeRecordsColumns(database);
    this.db = database;
    return database;
  }

  private run<T>(fn: () => T | Promise<T>): Promise<T> {
    const p = this.chain.then(() => fn());
    this.chain = p.then(
      () => undefined,
      () => undefined
    );
    return p;
  }

  private parseContext(raw: string): PendingPunchContext {
    const o = JSON.parse(raw) as PendingPunchContext;
    if (!o || typeof o !== 'object' || !o.row) {
      throw new Error('context_json inválido');
    }
    return o;
  }

  /**
   * Fluxo principal: após coletar do relógio, persiste no SQLite **antes** do POST ao Supabase.
   * Retorna os ids (mesma ordem de `rows`) para `markRowsSynced` após sucesso.
   */
  async stageClockRowsBeforeSend(params: {
    timeLogsTable: string;
    deviceId: string;
    companyId: string | null;
    rows: Record<string, unknown>[];
    /**
     * Modo dual-write híbrido: grava só `time_records` local (synced=0) para o worker `syncService.js`;
     * não preenche `pending_punches` nem envia `clock_event_logs` no mesmo ciclo.
     */
    skipPendingPunches?: boolean;
  }): Promise<string[]> {
    if (params.rows.length === 0) return [];
    return this.run(() => this.insertClockRowsInternal({ ...params }, undefined));
  }

  /**
   * Caminho legado: falha de POST sem staging prévio — grava após erro (mesma forma física na tabela).
   */
  async enqueueFromBulkFailure(params: {
    timeLogsTable: string;
    deviceId: string;
    companyId: string | null;
    rows: Record<string, unknown>[];
    errorMessage: string;
  }): Promise<void> {
    if (params.rows.length === 0) return;
    await this.run(() => {
      this.insertClockRowsInternal(
        {
          timeLogsTable: params.timeLogsTable,
          deviceId: params.deviceId,
          companyId: params.companyId,
          rows: params.rows,
        },
        params.errorMessage
      );
    });
  }

  /** Inserção síncrona; chamar apenas dentro de `run()`. */
  private insertClockRowsInternal(
    params: {
      timeLogsTable: string;
      deviceId: string;
      companyId: string | null;
      rows: Record<string, unknown>[];
      skipPendingPunches?: boolean;
    },
    lastError: string | undefined
  ): string[] {
    const db = this.getDb();
    const now = new Date().toISOString();
    const skipPending = params.skipPendingPunches === true;
    const ins = db.prepare(
      `INSERT INTO pending_punches (id, employee_id, timestamp, source, synced, context_json)
       VALUES (?, ?, ?, ?, 0, ?)`
    );
    const ids: string[] = [];
    const mirrorIns = db.prepare(
      `INSERT OR IGNORE INTO time_records (
        id, company_id, rep_id, nsr, p_pis, p_cpf, p_matricula, p_data_hora, p_tipo_marcacao, p_raw_data, synced, synced_at, sync_attempts, last_sync_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL)`
    );
    const trx = db.transaction(() => {
      for (const row of params.rows) {
        if (!skipPending) {
          const id = randomUUID();
          ids.push(id);
          const employeeId = parseRowString(row.employee_id);
          const occurredAt = parseRowString(row.occurred_at);
          const ctx: PendingPunchContext = {
            attempts: 0,
            nextRetryAt: now,
            timeLogsTable: params.timeLogsTable,
            deviceId: params.deviceId,
            companyId: params.companyId,
            row,
            ...(lastError !== undefined ? { lastError } : {}),
          };
          ins.run(id, employeeId, occurredAt, 'clock' satisfies PendingPunchSource, JSON.stringify(ctx));
        }
        OfflineQueue.insertMirrorTimeRecordRow(mirrorIns, params.deviceId, params.companyId, row);
      }
    });
    trx();
    return ids;
  }

  /**
   * Cópia local para o serviço `services/syncService.js` (NSR obrigatório para chave rep_id+nsr).
   */
  /** NSR estável quando o relógio não envia NSR (dedupe do ciclo de sync). */
  static syntheticNsrFromDedupe(dedupe: string): number {
    let h = 2166136261;
    for (let i = 0; i < dedupe.length; i++) {
      h ^= dedupe.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const u = h >>> 0;
    return (u % 2000000000) + 1;
  }

  private static insertMirrorTimeRecordRow(
    mirrorIns: Database.Statement,
    deviceId: string,
    companyId: string | null,
    row: Record<string, unknown>
  ): void {
    if (!companyId) return;
    const raw = row.raw && typeof row.raw === 'object' ? (row.raw as Record<string, unknown>) : {};
    let nsr: number | null = null;
    if (typeof raw.nsr === 'number' && Number.isFinite(raw.nsr)) nsr = Math.floor(raw.nsr);
    else if (typeof raw.nsr === 'string' && /^\d+$/.test(raw.nsr)) nsr = parseInt(raw.nsr, 10);
    const dedupe = parseRowString(row.dedupe_hash);
    if (nsr == null) {
      if (!dedupe) return;
      nsr = OfflineQueue.syntheticNsrFromDedupe(dedupe);
    }

    const employeeRef = parseRowString(row.employee_id);
    const { p_pis, p_cpf, p_matricula } = employeeFieldsFromRef(employeeRef);
    const occurredAt = parseRowString(row.occurred_at);
    const tipo = eventTypeToTipoMarcacao(parseRowString(row.event_type));
    const mirrorId = randomUUID();
    mirrorIns.run(
      mirrorId,
      companyId,
      deviceId,
      nsr,
      p_pis,
      p_cpf,
      p_matricula,
      occurredAt,
      tipo,
      JSON.stringify(row)
    );
  }

  /**
   * Batida registrada offline (ex.: web/mobile) — mesmo destino PostgREST.
   */
  async enqueueWebPunch(params: {
    timeLogsTable: string;
    deviceId: string;
    companyId: string | null;
    row: Record<string, unknown>;
  }): Promise<string> {
    return this.run(() => {
      const db = this.getDb();
      const id = randomUUID();
      const employeeId = parseRowString(params.row.employee_id);
      const occurredAt = parseRowString(params.row.occurred_at);
      const now = new Date().toISOString();
      const ctx: PendingPunchContext = {
        attempts: 0,
        nextRetryAt: now,
        timeLogsTable: params.timeLogsTable,
        deviceId: params.deviceId,
        companyId: params.companyId,
        row: params.row,
      };
      db.prepare(
        `INSERT INTO pending_punches (id, employee_id, timestamp, source, synced, context_json)
         VALUES (?, ?, ?, 'web', 0, ?)`
      ).run(id, employeeId, occurredAt, JSON.stringify(ctx));
      return id;
    });
  }

  /** Itens pendentes prontos para reenvio (synced=0 e nextRetryAt <= agora). */
  async listPendingReady(now = new Date()): Promise<Array<{ id: string; context: PendingPunchContext }>> {
    return this.run(() => {
      const db = this.getDb();
      const t = now.getTime();
      const rows = db
        .prepare(
          `SELECT id, context_json FROM pending_punches WHERE synced = 0`
        )
        .all() as Array<{ id: string; context_json: string }>;

      const out: Array<{ id: string; context: PendingPunchContext }> = [];
      for (const r of rows) {
        try {
          const context = this.parseContext(r.context_json);
          if (new Date(context.nextRetryAt).getTime() <= t) {
            out.push({ id: r.id, context });
          }
        } catch (error) {
          void error;
        }
      }
      return out;
    });
  }

  /** Agrupa pendentes prontos por (tabela, device, empresa) para POST em lote. */
  async listReadyBatches(now = new Date()): Promise<PendingPunchBatch[]> {
    const pending = await this.listPendingReady(now);
    const map = new Map<string, PendingPunchBatch>();
    for (const { id, context } of pending) {
      const key = `${context.timeLogsTable}\0${context.deviceId}\0${context.companyId ?? ''}`;
      let b = map.get(key);
      if (!b) {
        b = {
          ids: [],
          timeLogsTable: context.timeLogsTable,
          deviceId: context.deviceId,
          companyId: context.companyId,
          rows: [],
        };
        map.set(key, b);
      }
      b.ids.push(id);
      b.rows.push(context.row);
    }
    return [...map.values()];
  }

  async rescheduleFailed(id: string, errorMessage: string): Promise<void> {
    await this.run(() => {
      const db = this.getDb();
      const row = db.prepare(`SELECT context_json FROM pending_punches WHERE id = ? AND synced = 0`).get(id) as
        | { context_json: string }
        | undefined;
      if (!row) return;
      const ctx = this.parseContext(row.context_json);
      ctx.attempts += 1;
      ctx.nextRetryAt = nextRetryIsoFromNow(ctx.attempts);
      ctx.lastError = errorMessage;
      db.prepare(`UPDATE pending_punches SET context_json = ? WHERE id = ?`).run(JSON.stringify(ctx), id);
    });
  }

  /** Marca como sincronizado com o cloud (não remove o registro). */
  async markSynced(id: string): Promise<void> {
    await this.run(() => {
      this.getDb().prepare(`UPDATE pending_punches SET synced = 1 WHERE id = ?`).run(id);
    });
  }

  async markSyncedMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.run(() => {
      const db = this.getDb();
      const upd = db.prepare(`UPDATE pending_punches SET synced = 1 WHERE id = ?`);
      const trx = db.transaction(() => {
        for (const id of ids) upd.run(id);
      });
      trx();
    });
  }

  /** @deprecated Preferir `markSynced`; mantido por compatibilidade. */
  async remove(id: string): Promise<void> {
    await this.markSynced(id);
  }

  async countPending(): Promise<number> {
    return this.run(() => {
      const row = this.getDb().prepare(`SELECT COUNT(*) AS c FROM pending_punches WHERE synced = 0`).get() as { c: number };
      return row.c;
    });
  }

  /** Compat: contagem de pendentes (não sincronizados). */
  async count(): Promise<number> {
    return this.countPending();
  }
}
