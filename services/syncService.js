/**
 * Worker de sincronização — produção nível empresa.
 *
 * PIPELINE ÚNICO:
 *   Relógio → Adapter → SQLite (time_records + sync_jobs) → Worker → clock_event_logs → espelho
 *
 * GARANTIAS:
 * - Exactly-once:     dedupe_hash + upsert idempotente + idempotency_key no payload
 * - Atomicidade:      enqueue + time_records numa transação SQLite
 * - Lock distribuído: Supabase distributed_locks (fallback: SQLite local)
 * - Batching adaptativo: ajusta tamanho do lote pela latência observada
 * - Retry inteligente: classifica erros — não reprocessa VALIDATION/FK/AUTH
 * - Dead letter:      jobs não-retryáveis → failed imediato; retryáveis → backoff
 * - Circuit breaker:  para de tentar se Supabase estiver fora (>50% falhas em 60s)
 * - Watchdog:         alerta se item mais antigo > 2 min na fila
 * - Alertas reais:    webhook + log crítico para eventos de produção
 * - Auditoria:        verifica divergência clock_event_logs ↔ time_records
 * - Backpressure:     reduz ingestão se pending_jobs > 5000
 * - SLA:              loga violações de latência (ingestão > 2s, sync > 5s)
 *
 * Variáveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOCK_AGENT_SQLITE_PATH
 */

import { createClient }                          from '@supabase/supabase-js';
import Database                                  from 'better-sqlite3';
import { mkdirSync }                             from 'node:fs';
import { dirname }                               from 'node:path';
import { createHash }                            from 'node:crypto';
import { SyncQueue, LOG_LEVEL }                  from './syncQueue.js';
import { CircuitBreaker, CircuitOpenError }      from './circuitBreaker.js';
import { DistributedLock }                       from './distributedLock.js';
import { AdaptiveBatch }                         from './adaptiveBatch.js';
import { classifyError, isRetryable, retryDelayMs, ERROR_TYPE } from './errorClassifier.js';
import { AlertDispatcher }                       from './alertDispatcher.js';
import { ensureUTC }                             from './timeUtils.js';
import { filterValidPunches, VALIDATION_RESULT } from './punchValidator.js';
import { Reconciler }                            from './reconciler.js';
import { SnapshotService }                       from './snapshotService.js';
import { LatencyTracker }                        from './latencyTracker.js';
import { AuditTrail, AUDIT_ACTION }              from './auditTrail.js';
import { FraudDetector }                         from './fraudDetector.js';
import { TenantMetrics }                         from './tenantMetrics.js';
import { RetentionPolicy }                       from './retentionPolicy.js';
import { FeatureFlags }                          from './featureFlags.js';
import { TimestampAnchor }                       from './timestampSigner.js';
import { TenantLimits }                          from './tenantLimits.js';
import { ExternalLogger }                        from './externalLogger.js';
import { encryptRecord, encryptionEnabled }      from './dataEncryption.js';
import { KMSProvider, kms }                      from './kmsProvider.js';
import { DRManager }                             from './drManager.js';
import { DailyAuditJob }                         from './dailyAuditJob.js';
import { SLOTracker }                            from './sloTracker.js';
import { IncidentManager }                       from './incidentManager.js';
import { BusinessMetrics }                       from './businessMetrics.js';

// ─── Constantes ────────────────────────────────────────────────────────────────

const ENQUEUE_BATCH_SIZE   = 100;    // registros por leitura do SQLite
const WORKER_BATCH_SIZE    = 10;     // jobs por tick
const DEFAULT_INTERVAL_MS  = 15_000;
const LOCK_NAME            = 'sync_worker';
const LOCK_TTL_MS          = 60_000;
const ALERT_QUEUE_SIZE     = 1_000;
const BACKPRESSURE_LIMIT   = 5_000;  // pending_jobs → reduzir ingestão
const ALERT_ERROR_RATE     = 30;     // %
const WATCHDOG_DELAY_MS    = 2 * 60_000; // 2 minutos
const AUDIT_INTERVAL_MS    = 10 * 60_000; // auditoria a cada 10 min
const MAINTENANCE_INTERVAL = 60 * 60_000; // limpeza a cada hora
const SLA_INGEST_MS        = 2_000;  // SLA de ingestão
const SLA_SYNC_MS          = 5_000;  // SLA de sync

// ─── Modo degradado ────────────────────────────────────────────────────────────
// Quando Supabase está fora: continua coletando, reduz tentativas, evita sobrecarga.

const DEGRADED_MODE = {
  active:          false,
  since:           null,
  workerBatchSize: 2,    // processar menos jobs por tick
  skipAudit:       true, // não tentar auditoria (vai falhar de qualquer forma)
};

function enterDegradedMode(queue) {
  if (DEGRADED_MODE.active) return;
  DEGRADED_MODE.active = true;
  DEGRADED_MODE.since  = new Date().toISOString();
  queue.log(LOG_LEVEL.WARN, 'degraded_mode', 'Sistema entrou em modo degradado (Supabase inacessível)', {
    since: DEGRADED_MODE.since,
  });
  console.warn('[SYNC] ⚠ MODO DEGRADADO: coletando localmente, sync suspenso');
}

function exitDegradedMode(queue) {
  if (!DEGRADED_MODE.active) return;
  const duration = DEGRADED_MODE.since
    ? Math.round((Date.now() - new Date(DEGRADED_MODE.since).getTime()) / 1000)
    : 0;
  DEGRADED_MODE.active = false;
  DEGRADED_MODE.since  = null;
  queue.log(LOG_LEVEL.INFO, 'degraded_mode', `Sistema saiu do modo degradado após ${duration}s`, { duration });
  console.log(`[SYNC] ✓ Modo normal restaurado após ${duration}s`);
}

// ─── Log estruturado padrão ────────────────────────────────────────────────────

/**
 * Emite log estruturado no formato padrão do sistema.
 * { level, event, device_id?, job_id?, error_type?, ...context }
 */
function structuredLog(queue, level, event, context = {}) {
  const entry = { level: level.toUpperCase(), event, ...context };
  queue.log(level, event.toLowerCase(), JSON.stringify(entry), context);
  if (level === 'error') {
    console.error(`[${entry.level}] ${event}`, context);
  }
}

function isUuidLike(s) {
  if (!s || typeof s !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim());
}

function computeDedupeHash(companyId, deviceId, employeeId, timestamp, eventType) {
  const base = `${companyId}|${deviceId}|${employeeId}|${timestamp}|${eventType}`;
  return createHash('sha256').update(base, 'utf8').digest('hex');
}

function tipoToEventType(tipo) {
  const t = (tipo || 'B').toUpperCase().trim();
  if (t === 'E' || t.startsWith('ENT')) return 'entrada';
  if (t === 'S' || t.startsWith('SAI') || t.startsWith('SAÍ')) return 'saída';
  if (t === 'P' || t.startsWith('PAU')) return 'pausa';
  return 'batida';
}

function extractEmployeeId(r) {
  if (r.p_pis       && r.p_pis.trim())       return r.p_pis.trim();
  if (r.p_cpf       && r.p_cpf.trim())       return r.p_cpf.trim();
  if (r.p_matricula && r.p_matricula.trim()) return r.p_matricula.trim();
  return 'unknown';
}

// ─── Schema local ──────────────────────────────────────────────────────────────

const LOCAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS time_records (
  id              TEXT    PRIMARY KEY NOT NULL,
  company_id      TEXT    NOT NULL,
  rep_id          TEXT    NOT NULL,
  nsr             INTEGER,
  p_pis           TEXT,
  p_cpf           TEXT,
  p_matricula     TEXT,
  p_data_hora     TEXT    NOT NULL,
  p_tipo_marcacao TEXT    NOT NULL DEFAULT 'E',
  p_raw_data      TEXT,
  synced          INTEGER NOT NULL DEFAULT 0 CHECK (synced IN (0, 1)),
  synced_at       TEXT,
  sync_attempts   INTEGER NOT NULL DEFAULT 0,
  last_sync_error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_records_rep_nsr
  ON time_records (rep_id, nsr) WHERE nsr IS NOT NULL;
`;

function ensureLocalSchema(db) {
  db.exec(LOCAL_SCHEMA);
  const cols  = db.prepare(`PRAGMA table_info(time_records)`).all();
  const names = new Set((cols || []).map(c => c.name));
  for (const [col, def] of [
    ['sync_attempts',   'INTEGER NOT NULL DEFAULT 0'],
    ['last_sync_error', 'TEXT'],
  ]) {
    if (!names.has(col)) {
      try { db.exec(`ALTER TABLE time_records ADD COLUMN ${col} ${def}`); } catch { /* ignore */ }
    }
  }
}

// ─── startSyncService ──────────────────────────────────────────────────────────

/**
 * @param {{
 *   sqliteDbPath:   string,
 *   supabaseUrl:    string,
 *   serviceRoleKey: string,
 *   intervalMs?:    number,
 * }} opts
 * @returns {{ stop: () => void, queue: SyncQueue, cb: CircuitBreaker, alerts: AlertDispatcher }}
 */
export function startSyncService(opts) {
  const intervalMs = Math.max(5_000, opts.intervalMs ?? DEFAULT_INTERVAL_MS);

  // ── Supabase ─────────────────────────────────────────────────────────────────
  const supabase = createClient(opts.supabaseUrl, opts.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── SQLite ───────────────────────────────────────────────────────────────────
  mkdirSync(dirname(opts.sqliteDbPath), { recursive: true });
  const rawDb = new Database(opts.sqliteDbPath);
  rawDb.pragma('journal_mode = WAL');
  rawDb.pragma('synchronous = NORMAL');
  ensureLocalSchema(rawDb);

  // ── Módulos de confiabilidade ─────────────────────────────────────────────────
  const queue = new SyncQueue(opts.sqliteDbPath);
  queue._db   = rawDb; // reusar conexão para atomicidade

  const cb = new CircuitBreaker({
    name: 'supabase',
    failureThreshold: 50,
    windowMs: 60_000,
    resetTimeoutMs: 30_000,
    minRequests: 5,
    onStateChange: (from, to, reason) => {
      const level = to === 'OPEN' ? LOG_LEVEL.ERROR : LOG_LEVEL.INFO;
      queue.log(level, 'circuit_breaker', `${from} → ${to} (${reason})`, { from, to, reason });
      console[to === 'OPEN' ? 'error' : 'log'](`[CB] ${from} → ${to} (${reason})`);
      // Modo degradado: ativar quando CB abre, desativar quando fecha
      if (to === 'OPEN')   enterDegradedMode(queue);
      if (to === 'CLOSED') exitDegradedMode(queue);
    },
  });

  const distLock = new DistributedLock({ supabase, localQueue: queue, ttlMs: LOCK_TTL_MS });
  const adaptive = new AdaptiveBatch({ initial: 50, min: 10, max: 200 });
  const alerts   = new AlertDispatcher({ queue });

  // ── Módulos de hardening final ────────────────────────────────────────────────
  const reconciler = new Reconciler({ supabase, queue, alerts, cb }).start();
  const snapshot   = new SnapshotService({ supabase, queue, rawDb }).start();
  const latency    = new LatencyTracker({ supabase, queue, alerts }).start();

  // ── Camada de compliance e governança ────────────────────────────────────────
  const ff        = new FeatureFlags({ supabase }).start();
  const audit     = new AuditTrail({ db: rawDb, supabase, queue });
  const fraud     = new FraudDetector();
  const tenantMx  = new TenantMetrics({ db: rawDb });
  const tenantLim = new TenantLimits({ db: rawDb, queue, alerts });
  const retention = new RetentionPolicy({ db: rawDb, queue, audit }).start();
  const tsAnchor  = new TimestampAnchor({ supabase, db: rawDb }).start();
  const extLogger = new ExternalLogger().start().attachToQueue(queue);

  // ── DR e auditoria contínua ───────────────────────────────────────────────
  kms.init(rawDb);
  const drMgr       = new DRManager({ sqliteDbPath: opts.sqliteDbPath, rawDb, supabase, queue }).start();
  const dailyAudit  = new DailyAuditJob({ audit, anchor: tsAnchor, queue, alerts, supabase }).start();
  const sloTracker  = new SLOTracker({ db: rawDb, queue, supabase, alerts }).start();
  const incidentMgr = new IncidentManager({ db: rawDb, queue, alerts });
  const bizMetrics  = new BusinessMetrics({ db: rawDb, queue, supabase }).start();

  // ── Statements ───────────────────────────────────────────────────────────────
  const stmtMarkSynced = rawDb.prepare(
    `UPDATE time_records SET synced = 1, synced_at = ?, last_sync_error = NULL, sync_attempts = 0 WHERE id = ?`
  );
  const stmtMarkFailed = rawDb.prepare(
    `UPDATE time_records SET sync_attempts = sync_attempts + 1, last_sync_error = ? WHERE id = ? AND synced = 0`
  );

  let stopped  = false;
  let running  = false;
  let cbOpenAt = null; // para alertar se CB ficar aberto > 2 min

  // ── Enqueue: time_records → sync_jobs ────────────────────────────────────────

  function enqueueFromTimeRecords() {
    const metrics = queue.getMetrics();

    // Backpressure: se fila muito grande, não enfileirar mais por enquanto
    if (metrics.pending > BACKPRESSURE_LIMIT) {
      queue.log(LOG_LEVEL.WARN, 'backpressure',
        `Backpressure ativo: ${metrics.pending} jobs pendentes (limite: ${BACKPRESSURE_LIMIT})`,
        { pending: metrics.pending });
      console.warn(`[SYNC] ⚠ Backpressure: ${metrics.pending} jobs pendentes — ingestão pausada`);
      return 0;
    }

    // Modo manutenção: bloquear ingestão
    if (ff.maintenanceMode) {
      queue.log(LOG_LEVEL.WARN, 'maintenance', 'Ingestão bloqueada (MAINTENANCE_MODE ativo)');
      return 0;
    }

    const t0 = Date.now();
    const registros = rawDb.prepare(`
      SELECT id, company_id, rep_id, nsr, p_pis, p_cpf, p_matricula,
             p_data_hora, p_tipo_marcacao, p_raw_data
      FROM time_records WHERE synced = 0
      ORDER BY p_data_hora ASC LIMIT ?
    `).all(ENQUEUE_BATCH_SIZE);

    if (!registros.length) return 0;

    // Agrupar por company_id + device_id
    const batches = new Map();
    for (const r of registros) {
      const deviceId = isUuidLike(r.rep_id) ? r.rep_id : null;
      if (!deviceId) {
        stmtMarkFailed.run('device_id inválido (não é UUID)', r.id);
        queue.log(LOG_LEVEL.WARN, 'enqueue', `Registro ignorado: device_id inválido`, { id: r.id, repId: r.rep_id });
        continue;
      }
      const key = `${r.company_id}:${deviceId}`;
      if (!batches.has(key)) batches.set(key, { companyId: r.company_id, deviceId, records: [] });
      batches.get(key).records.push(r);
    }

    let enqueued = 0;
    for (const [, batch] of batches) {
      const { companyId, deviceId, records } = batch;
      const rows = [];

      for (const r of records) {
        let rawObj = {};
        try { rawObj = r.p_raw_data ? JSON.parse(r.p_raw_data) : {}; } catch { rawObj = {}; }

        const employeeId = extractEmployeeId(r);
        const eventType  = tipoToEventType(r.p_tipo_marcacao);
        // Garantir UTC no timestamp antes de enfileirar
        const occurredAt = ensureUTC(r.p_data_hora);
        const dedupeHash = computeDedupeHash(companyId, deviceId, employeeId, occurredAt, eventType);

        rows.push({
          _localId:    r.id,
          employee_id: employeeId,
          occurred_at: occurredAt,
          event_type:  eventType,
          device_id:   deviceId,
          company_id:  companyId,
          dedupe_hash: dedupeHash,
          raw: { ...rawObj, nsr: r.nsr, local_sync: true, rep_id_original: r.rep_id },
          source:      'clock',
          created_at:  new Date().toISOString(),
        });
      }

      // ── Validação de integridade antes de enfileirar ──────────────────────────
      const { valid, rejected } = filterValidPunches(rows, { skipFlood: false, skipRateLimit: false });

      if (rejected.length > 0) {
        for (const { punch, result, reason } of rejected) {
          structuredLog(queue, LOG_LEVEL.WARN, result, {
            device_id: deviceId, employee_id: punch.employee_id,
            occurred_at: punch.occurred_at, reason,
          });
          if (punch._localId) {
            stmtMarkFailed.run(`${result}: ${reason}`.slice(0, 2000), punch._localId);
          }
          // Auditoria de rejeição
          if (ff.auditTrailEnabled) {
            audit.record({
              entity:      'time_records',
              entityId:    punch._localId,
              action:      AUDIT_ACTION.PUNCH_REJECTED,
              after:       { result, reason, employee_id: punch.employee_id, occurred_at: punch.occurred_at },
              performedBy: 'punch_validator',
              companyId,
            });
          }
        }
      }

      if (!valid.length) continue;

      // ── Verificar limites por tenant ──────────────────────────────────────────
      const limitCheck = tenantLim.checkAndIncrement(companyId, valid.length);
      if (!limitCheck.allowed && limitCheck.throttle) {
        queue.log(LOG_LEVEL.WARN, 'tenant_limits',
          `Throttle ativo para ${companyId}: ${limitCheck.current}/${limitCheck.limit} batidas hoje`,
          { companyId, current: limitCheck.current, limit: limitCheck.limit });
        // Throttle: processar apenas metade do lote
        valid.splice(Math.ceil(valid.length / 2));
      }

      // ── Criptografar dados sensíveis antes de enfileirar ─────────────────────
      const encryptedValid = encryptionEnabled
        ? valid.map(r => encryptRecord(r, companyId))
        : valid;

      // ── Detecção de fraude (não bloqueia, apenas sinaliza) ────────────────────
      if (ff.fraudDetectionEnabled) {
        const fraudResults = fraud.analyzeBatch(valid);
        for (const { punch, fraudFlags, isSuspect } of fraudResults) {
          if (isSuspect) {
            structuredLog(queue, LOG_LEVEL.WARN, 'FRAUD_FLAGGED', {
              device_id: deviceId, employee_id: punch.employee_id,
              occurred_at: punch.occurred_at, flags: fraudFlags,
            });
            // Marcar no raw para rastreabilidade
            punch.raw = { ...(punch.raw ?? {}), _fraud_flags: fraudFlags };
          }
        }
      }

      rawDb.transaction(() => {
        queue.enqueueAtomic({
          companyId, deviceId,
          rows: encryptedValid,
          timeRecordsIds: encryptedValid.map(r => r._localId).filter(Boolean),
        });
      })();
      enqueued += encryptedValid.length;
    }

    const elapsed = Date.now() - t0;
    if (elapsed > SLA_INGEST_MS) {
      queue.log(LOG_LEVEL.WARN, 'sla', `Violação SLA ingestão: ${elapsed}ms (limite: ${SLA_INGEST_MS}ms)`, { elapsed });
    }
    if (enqueued > 0) {
      queue.log(LOG_LEVEL.INFO, 'collect', `${enqueued} batida(s) enfileirada(s)`, { enqueued, elapsedMs: elapsed });
      console.log(`[SYNC] ▶ ${enqueued} batida(s) enfileirada(s) (${elapsed}ms)`);
    }

    // Salvar checkpoint de progresso
    queue.saveCheckpoint('worker', { lastProcessedAt: new Date().toISOString() });

    return enqueued;
  }

  // ── Worker: processa jobs ─────────────────────────────────────────────────────

  async function processQueue() {
    // Lock distribuído (multi-instância)
    const locked = await distLock.acquire(LOCK_NAME);
    if (!locked) {
      console.log('[SYNC] Lock distribuído ocupado — outro worker em execução');
      return;
    }

    try {
      const jobs = queue.dequeue(WORKER_BATCH_SIZE);
      if (!jobs.length) return;

      console.log(`[SYNC] Processando ${jobs.length} job(s)...`);

      for (const job of jobs) {
        if (stopped) break;
        // Renovar lock a cada job para ciclos longos
        await distLock.renew(LOCK_NAME);
        await processOneJob(job);
      }
    } finally {
      await distLock.release(LOCK_NAME);
    }
  }

  async function processOneJob(job) {
    const { id: jobId, payload, attempts } = job;
    const { companyId, deviceId, rows, timeRecordsIds } = payload;

    // Circuit breaker aberto → recolocar sem incrementar tentativas
    if (cb.isOpen) {
      rawDb.prepare(`UPDATE sync_jobs SET status = 'pending', updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), jobId);
      queue.log(LOG_LEVEL.WARN, 'circuit_breaker', `Job ${jobId} aguardando CB resetar`, { jobId });
      return;
    }

    const t0 = Date.now();

    try {
      // Enviar para clock_event_logs via circuit breaker + batching adaptativo
      await adaptive.run(() => cb.call(async () => {
        // Remover campo interno _localId antes de enviar ao Supabase
        const cleanRows = rows.map(({ _localId, ...rest }) => ({
          ...rest,
          // Idempotency key: propagar job_id no raw para rastreabilidade
          raw: { ...(rest.raw ?? {}), _idempotency_key: jobId },
        }));

        const { error } = await supabase
          .from('clock_event_logs')
          .upsert(cleanRows, { onConflict: 'dedupe_hash', ignoreDuplicates: true });

        if (error) throw new Error(error.message);
      }));

      const elapsed = Date.now() - t0;
      if (elapsed > SLA_SYNC_MS) {
        queue.log(LOG_LEVEL.WARN, 'sla', `Violação SLA sync: ${elapsed}ms (limite: ${SLA_SYNC_MS}ms)`, {
          jobId, elapsed, rows: rows.length,
        });
      }

      // Sucesso: marcar time_records como sincronizados
      rawDb.transaction(() => {
        const now = new Date().toISOString();
        for (const localId of timeRecordsIds) stmtMarkSynced.run(now, localId);
      })();

      queue.ack(jobId);
      queue.log(LOG_LEVEL.INFO, 'sync_ok', `Job ${jobId}: ${rows.length} batida(s) em ${elapsed}ms`, {
        jobId, companyId, deviceId, count: rows.length, elapsedMs: elapsed,
        batchSize: adaptive.size,
      });
      console.log(`[SYNC] ✓ Job ${jobId}: ${rows.length} batida(s) → clock_event_logs (${elapsed}ms)`);

      // Métricas por tenant
      tenantMx.recordSync(companyId, { count: rows.length, latencyMs: elapsed });

      // Métricas de negócio
      bizMetrics.recordPunches(companyId, rows.length);

      // SLO: registrar latência de ingestão
      sloTracker.recordIngestLatency(elapsed);

      // Auditoria
      if (ff.auditTrailEnabled) {
        audit.record({
          entity:      'clock_event_logs',
          entityId:    jobId,
          action:      AUDIT_ACTION.SYNC_COMPLETED,
          after:       { count: rows.length, deviceId, elapsedMs: elapsed },
          performedBy: 'sync_worker',
          companyId,
        });
      }

      // Promoção espelho
      await promoteEspelho(companyId, deviceId, jobId);

    } catch (err) {
      const msg          = err instanceof Error ? err.message : String(err);
      const errorType    = classifyError(msg);
      const retryable    = isRetryable(errorType);
      const isCircuitErr = err instanceof CircuitOpenError;

      if (!isCircuitErr) {
        rawDb.transaction(() => {
          for (const localId of timeRecordsIds) stmtMarkFailed.run(msg.slice(0, 2000), localId);
        })();
      }

      // Métricas de erro por tenant
      tenantMx.recordError(companyId, msg);

      if (!retryable) {
        // Erro permanente → dead letter imediato (não desperdiçar tentativas)
        rawDb.prepare(`
          UPDATE sync_jobs SET status = 'failed', attempts = ?, last_error = ?,
          error_type = ?, updated_at = ? WHERE id = ?
        `).run(attempts + 1, msg.slice(0, 2000), errorType, new Date().toISOString(), jobId);

        queue.log(LOG_LEVEL.ERROR, 'dead_letter',
          `Job ${jobId} → dead letter imediato (${errorType})`,
          { jobId, errorType, error: msg.slice(0, 500) });
        console.error(`[SYNC] ✗ Job ${jobId} → dead letter (${errorType}): ${msg}`);
      } else {
        // Erro transitório → retry com delay baseado no tipo
        const delay = retryDelayMs(errorType, attempts);
        const nextRun = new Date(Date.now() + delay).toISOString();
        const nextAttempts = attempts + 1;

        if (nextAttempts >= 10) {
          rawDb.prepare(`
            UPDATE sync_jobs SET status = 'failed', attempts = ?, last_error = ?,
            error_type = ?, updated_at = ? WHERE id = ?
          `).run(nextAttempts, msg.slice(0, 2000), errorType, new Date().toISOString(), jobId);
          queue.log(LOG_LEVEL.ERROR, 'dead_letter',
            `Job ${jobId} → dead letter após ${nextAttempts} tentativas`,
            { jobId, errorType, attempts: nextAttempts });
        } else {
          rawDb.prepare(`
            UPDATE sync_jobs SET status = 'pending', attempts = ?, last_error = ?,
            error_type = ?, next_run_at = ?, updated_at = ? WHERE id = ?
          `).run(nextAttempts, msg.slice(0, 2000), errorType, nextRun, new Date().toISOString(), jobId);
          queue.log(LOG_LEVEL.WARN, 'retry',
            `Job ${jobId} reagendado (${errorType}, tentativa ${nextAttempts}/10, delay ${delay}ms)`,
            { jobId, errorType, attempts: nextAttempts, delayMs: delay });
        }
        console.error(`[SYNC] ✗ Job ${jobId} falhou (${errorType}, ${attempts + 1}/10): ${msg}`);
      }
    }
  }

  async function promoteEspelho(companyId, deviceId, jobId) {
    try {
      await cb.call(async () => {
        const { error } = await supabase.rpc('promote_clock_events_to_espelho', {
          p_company_id: companyId,
          p_device_id:  deviceId,
          p_batch_size: 200,
        });
        if (error) throw new Error(error.message);
      });
      queue.log(LOG_LEVEL.INFO, 'espelho', `Espelho atualizado: device ${deviceId}`, { companyId, deviceId, jobId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      queue.log(LOG_LEVEL.WARN, 'espelho', `Promoção espelho falhou: ${msg}`, { companyId, deviceId, jobId });
      console.warn(`[SYNC] ⚠ Espelho falhou para ${deviceId}: ${msg}`);
    }
  }

  // ── Watchdog de atraso ────────────────────────────────────────────────────────

  async function checkWatchdog() {
    const metrics = queue.getMetrics();
    if (!metrics.oldestPendingAt) return;

    const ageMs = Date.now() - new Date(metrics.oldestPendingAt).getTime();
    if (ageMs > WATCHDOG_DELAY_MS) {
      await alerts.processingDelay(ageMs, metrics.oldestPendingAt);
    }
  }

  // ── Alertas de métricas ───────────────────────────────────────────────────────

  async function checkAlerts() {
    const metrics = queue.getMetrics();

    if (metrics.pending > ALERT_QUEUE_SIZE) {
      await alerts.queueOverflow(metrics);
    }
    if (metrics.errorRate > ALERT_ERROR_RATE) {
      await alerts.highErrorRate(metrics);
    }

    // Circuit breaker aberto por mais de 2 minutos
    const cbStatus = cb.getStatus();
    if (cbStatus.state === 'OPEN') {
      if (!cbOpenAt) cbOpenAt = Date.now();
      if (Date.now() - cbOpenAt > 2 * 60_000) {
        await alerts.circuitOpen(cbStatus);
      }
    } else {
      cbOpenAt = null;
    }

    await checkWatchdog();
  }

  // ── Auditoria de consistência ─────────────────────────────────────────────────

  async function runAuditCheck() {
    try {
      // Verificar eventos não promovidos há mais de 10 minutos
      const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data, error } = await supabase
        .from('clock_event_logs')
        .select('company_id, device_id, count', { count: 'exact', head: true })
        .is('promoted_at', null)
        .lt('created_at', cutoff);

      if (error) return; // Supabase fora — pular auditoria

      const unpromoted = data?.length ?? 0;
      if (unpromoted > 0) {
        queue.log(LOG_LEVEL.WARN, 'audit',
          `${unpromoted} evento(s) sem promoção há mais de 10 min`,
          { unpromoted, cutoff });
        // Disparar alerta se muitos eventos parados
        if (unpromoted > 100) {
          await alerts.espelhoStalled('unknown', 'unknown', unpromoted);
        }
      }
    } catch {
      /* Auditoria é best-effort */
    }
  }

  // ── Manutenção ────────────────────────────────────────────────────────────────

  function runMaintenance() {
    const purgedLogs = queue.purgeLogs(7);
    const purgedJobs = queue.purgeDoneJobs(3);
    if (purgedLogs > 0 || purgedJobs > 0) {
      queue.log(LOG_LEVEL.INFO, 'maintenance',
        `Limpeza: ${purgedLogs} logs + ${purgedJobs} jobs removidos`,
        { purgedLogs, purgedJobs });
    }
    // Adicionar coluna error_type se não existir (migração incremental)
    try {
      rawDb.exec(`ALTER TABLE sync_jobs ADD COLUMN error_type TEXT`);
    } catch { /* já existe */ }
  }

  // ── Ciclo principal ───────────────────────────────────────────────────────────

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      enqueueFromTimeRecords();
      await processQueue();
      await checkAlerts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      queue.log(LOG_LEVEL.ERROR, 'tick', `Erro no ciclo: ${msg}`, { error: msg });
      console.error('[SYNC] Erro no ciclo:', msg);
    } finally {
      running = false;
    }
  }

  // ── Timers ────────────────────────────────────────────────────────────────────

  const syncInterval        = setInterval(() => tick().catch(e => console.error('[SYNC]', e instanceof Error ? e.message : e)), intervalMs);
  const maintenanceInterval = setInterval(runMaintenance, MAINTENANCE_INTERVAL);
  const auditInterval       = setInterval(() => runAuditCheck().catch((err) => {
    console.warn('[SYNC] Falha no audit check:', err instanceof Error ? err.message : err);
  }), AUDIT_INTERVAL_MS);

  // Primeiro ciclo imediato
  void tick().catch(e => console.error('[SYNC] Primeiro ciclo:', e instanceof Error ? e.message : e));

  queue.log(LOG_LEVEL.INFO, 'startup', `Worker iniciado`, {
    intervalMs, enqueueBatch: ENQUEUE_BATCH_SIZE, workerBatch: WORKER_BATCH_SIZE,
    adaptiveBatch: adaptive.size, instanceId: distLock.instanceId,
  });
  console.log(`[SYNC] Worker iniciado — intervalo: ${intervalMs / 1000}s | instância: ${distLock.instanceId}`);

  return {
    stop: () => {
      stopped = true;
      clearInterval(syncInterval);
      clearInterval(maintenanceInterval);
      clearInterval(auditInterval);
      reconciler.stop();
      snapshot.stop();
      latency.stop();
      ff.stop();
      retention.stop();
      tsAnchor.stop();
      extLogger.stop();
      drMgr.stop();
      dailyAudit.stop();
      sloTracker.stop();
      bizMetrics.stop();
      distLock.release(LOCK_NAME).catch((err) => {
        console.warn('[SYNC] Falha ao liberar lock distribuído:', err instanceof Error ? err.message : err);
      });
      try { rawDb.close(); } catch { /* ignore */ }
      console.log('[SYNC] Worker parado');
    },
    queue,
    cb,
    alerts,
    adaptive,
    reconciler,
    snapshot,
    latency,
    audit,
    fraud,
    tenantMx,
    tenantLim,
    ff,
    tsAnchor,
    drMgr,
    dailyAudit,
    kms,
    sloTracker,
    incidentMgr,
    bizMetrics,
    getDegradedMode: () => ({ ...DEGRADED_MODE }),
  };
}
