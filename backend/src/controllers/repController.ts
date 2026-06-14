import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';
import { resolveUserForRepPunch } from '../services/repUserMatch.service.js';
import {
  enqueueRepTimesheetRecalcJobs,
  isRepIngestMigrationError,
  logRepPipelineDbDiagnostics,
  logRepPipelineTelemetry,
  processRepCalcDayJobsImmediate,
  promotePendingRepLogsAfterBatch,
  type RepPromotedRow,
} from '../services/repPostIngest.service.js';
import { executeRepRpcProxy, repRpcExistsInDatabase } from '../services/repRpcProxy.service.js';
import { resolveRepAdminCaller } from '../services/repAdminAuthService.js';
import { verifyRepAgentTokenVps, fetchRepDeviceCompanyId, type RepAgentAuthResult } from '../services/repAgentAuthService.js';
import { signRepCommandRow } from '../services/repCommandHmacService.js';
import { isPrivateOrLocalIPv4 } from '../utils/repNetwork.js';

type RepPunchBody = Record<string, unknown>;
type AdminJwtContext = {
  userId: string;
  companyId: string;
  role: string;
};
type RepDeviceAuth = {
  deviceId: string;
  companyId: string;
};

const REP_DEVICE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STUCK_COMMAND_PROCESSING_MS = 30_000;
const ADMIN_REP_COMMANDS = new Set([
  'test_connection',
  'collect_punches',
  'push_clock',
  'pull_clock',
  'pull_info',
  'pull_users',
  'push_employee',
]);
const REP_EXCHANGE_COMMANDS = new Set(['push_clock', 'pull_clock', 'pull_info', 'pull_users']);

function json(res: Response, status: number, body: Record<string, unknown>): void {
  res.status(status).json(body);
}

function authHeaderToken(req: Request): string {
  const raw = String(req.headers.authorization || req.headers['x-rep-api-key'] || req.headers['x-api-key'] || '').trim();
  return raw.replace(/^Bearer\s+/i, '').trim();
}

function repAgentAuthDenied(res: Response, result: Extract<RepAgentAuthResult, { ok: false }>): void {
  if (result.code === 'DEVICE_INACTIVE') {
    json(res, 403, { ok: false, success: false, error: 'device_inactive', code: 'DEVICE_INACTIVE' });
    return;
  }
  json(res, 401, { ok: false, success: false, error: 'unauthorized' });
}

async function requireRepDeviceAuth(req: Request, res: Response): Promise<RepDeviceAuth | null> {
  const token = authHeaderToken(req);
  const deviceId = String(
    req.params.deviceId ||
      req.body?.device_id ||
      req.body?.p_rep_device_id ||
      req.query.device_id ||
      '',
  ).trim();
  if (!deviceId) {
    json(res, 400, { ok: false, success: false, error: 'device_id é obrigatório' });
    return null;
  }
  const authResult = await verifyRepAgentTokenVps(token, deviceId);
  if (!authResult.ok) {
    repAgentAuthDenied(res, authResult);
    return null;
  }
  const companyId = await fetchRepDeviceCompanyId(deviceId);
  if (!companyId) {
    json(res, 404, { ok: false, success: false, error: 'device_not_found' });
    return null;
  }
  return { deviceId, companyId };
}

async function requireRepDeviceAuthFromPunches(req: Request, res: Response): Promise<RepDeviceAuth | null> {
  const list = Array.isArray(req.body?.punches) ? req.body.punches : [];
  const first = list[0] && typeof list[0] === 'object' ? (list[0] as RepPunchBody) : {};
  const deviceId = String(req.body?.device_id || first.device_id || req.query.device_id || '').trim();
  const token = authHeaderToken(req);
  if (!deviceId) {
    json(res, 400, { ok: false, success: false, error: 'device_id é obrigatório' });
    return null;
  }
  const authResult = await verifyRepAgentTokenVps(token, deviceId);
  if (!authResult.ok) {
    repAgentAuthDenied(res, authResult);
    return null;
  }
  const companyId = await fetchRepDeviceCompanyId(deviceId);
  if (!companyId) {
    json(res, 404, { ok: false, success: false, error: 'device_not_found' });
    return null;
  }
  return { deviceId, companyId };
}

async function requireRepAuth(req: Request, res: Response): Promise<boolean> {
  const auth = await requireRepDeviceAuth(req, res);
  return auth != null;
}

async function requireRepAdminCaller(req: Request, res: Response): Promise<AdminJwtContext | null> {
  const result = await resolveRepAdminCaller(req);
  if (!result.ok) {
    json(res, result.failure.status, {
      ok: false,
      success: false,
      error: result.failure.code,
      code: result.failure.code,
    });
    return null;
  }
  return result.caller;
}

async function repAdminCompanyId(req: Request): Promise<string> {
  const result = await resolveRepAdminCaller(req);
  return result.ok ? result.caller.companyId : '';
}

function normalizeUuid(value: unknown): string | null {
  const raw = String(value || '').trim();
  return REP_DEVICE_UUID_RE.test(raw) ? raw : null;
}

function normalizeDigits(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

async function assertRepDeviceForAdmin(deviceId: string, companyId: string): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `select id::text, company_id::text, nome_dispositivo, tipo_conexao, config_extra
       from public.rep_devices
      where id::text = $1 and company_id::text = $2
      limit 1`,
    [deviceId, companyId],
  );
  return result.rows[0] ?? null;
}

function isEmployeeEligibleForRepPushRow(row: Record<string, unknown>): boolean {
  if (row.invisivel === true) return false;
  if (row.demissao != null && String(row.demissao).trim() !== '') return false;
  const status = String(row.status ?? 'active').trim().toLowerCase();
  return status === 'active' || status === 'ativo';
}

async function fetchEmployeeForRepPush(userId: string, companyId: string): Promise<Record<string, unknown> | null> {
  const fromUsers = await pool.query(
    `select
        u.id::text as id,
        coalesce(nullif(e.nome, ''), nullif(u.nome, ''), nullif(u.email, ''), 'Colaborador') as nome,
        coalesce(nullif(e.cpf, ''), nullif(u.cpf, '')) as cpf,
        coalesce(nullif(trim(u.pis_pasep), ''), nullif(trim(e.pis), ''), nullif(trim(e.cpf), ''), nullif(trim(u.cpf), '')) as pis,
        coalesce(nullif(u.numero_folha, ''), nullif(u.numero_identificador, '')) as matricula,
        lower(coalesce(nullif(u.role, ''), 'employee')) as role,
        coalesce(u.status, 'active') as status,
        coalesce(u.invisivel, false) as invisivel,
        u.demissao as demissao
       from public.users u
       left join public.employees e
         on e.id::text = u.id::text
        and e.company_id::text = u.company_id::text
      where u.id::text = $1
        and u.company_id::text = $2
      limit 1`,
    [userId, companyId],
  );
  if (fromUsers.rows[0]) {
    const row = fromUsers.rows[0] as Record<string, unknown>;
    return isEmployeeEligibleForRepPushRow(row) ? row : null;
  }

  const fromEmployees = await pool.query(
    `select
        e.id::text as id,
        coalesce(nullif(e.nome, ''), 'Colaborador') as nome,
        nullif(e.cpf, '') as cpf,
        coalesce(nullif(trim(e.pis), ''), nullif(trim(e.cpf), '')) as pis,
        nullif(e.numero_folha, '') as matricula,
        'employee' as role,
        coalesce(e.status, 'active') as status,
        false as invisivel,
        null::date as demissao
       from public.employees e
      where e.id::text = $1
        and e.company_id::text = $2
      limit 1`,
    [userId, companyId],
  );
  const legacy = (fromEmployees.rows[0] as Record<string, unknown> | undefined) ?? null;
  if (!legacy) return null;
  return isEmployeeEligibleForRepPushRow(legacy) ? legacy : null;
}

function normalizeNsr(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function punchHashFromBody(body: RepPunchBody): string | null {
  const hash = String(body.punch_hash || body.hash || '').trim();
  return hash || null;
}

function buildRawData(
  body: RepPunchBody,
  tsIso: string,
  punchHash: string | null,
  companyId: string,
): Record<string, unknown> {
  const incoming = body.raw_data && typeof body.raw_data === 'object' && !Array.isArray(body.raw_data)
    ? (body.raw_data as Record<string, unknown>)
    : {};
  const identifiers = [normalizeDigits(body.pis), normalizeDigits(body.cpf)].filter(Boolean);
  return {
    ...incoming,
    source: 'REP',
    ingest: 'vps-rep-punch',
    company_id: companyId,
    timestamp_utc: tsIso,
    device_id: normalizeUuid(body.device_id),
    nsr: body.nsr ?? null,
    cpfOuPis: incoming.cpfOuPis ?? identifiers[0] ?? null,
    extracted_identifiers: Array.from(new Set([...(Array.isArray(incoming.extracted_identifiers) ? incoming.extracted_identifiers : []), ...identifiers])),
    punch_hash: punchHash,
    original: body,
  };
}

async function repIngestHasPunchHashParam(): Promise<boolean> {
  const result = await pool.query(
    `select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'rep_ingest_punch'
        and array_position(p.proargnames, 'p_punch_hash') is not null
      limit 1`,
  );
  return (result.rowCount ?? 0) > 0;
}

async function ingestRepPunch(body: RepPunchBody, auth: RepDeviceAuth): Promise<Record<string, unknown>> {
  const companyId = auth.companyId;
  const dataHoraRaw = String(body.data_hora || body.timestamp || '').trim();
  const bodyDeviceId = normalizeUuid(body.device_id);
  if (bodyDeviceId && bodyDeviceId !== auth.deviceId) {
    logger.warn({
      module: 'rep.ingest',
      action: 'PUNCH_REJECTED',
      companyId,
      message: 'Batida rejeitada: device_id não pertence ao dispositivo autenticado',
      meta: { device_id: bodyDeviceId, authenticated_device_id: auth.deviceId },
    });
    return { success: false, error: 'device_id não pertence ao dispositivo autenticado' };
  }
  const deviceId = auth.deviceId;
  if (!dataHoraRaw) {
    logger.warn({
      module: 'rep.ingest',
      action: 'PUNCH_REJECTED',
      companyId,
      message: 'Batida rejeitada: data_hora é obrigatório',
      meta: { device_id: deviceId, reason: 'missing_required_fields' },
    });
    return { success: false, error: 'data_hora é obrigatório' };
  }

  const ts = new Date(dataHoraRaw);
  if (Number.isNaN(ts.getTime())) {
    logger.warn({
      module: 'rep.ingest',
      action: 'PUNCH_REJECTED',
      companyId,
      message: 'Batida rejeitada: data_hora inválido',
      meta: { device_id: deviceId, data_hora: dataHoraRaw },
    });
    return { success: false, error: 'data_hora inválido' };
  }

  const punchHash = punchHashFromBody(body);
  const rawData = buildRawData(body, ts.toISOString(), punchHash, companyId);

  const forcedUserId = normalizeUuid(body.employee_id) ?? normalizeUuid(body.user_id);
  const match = await resolveUserForRepPunch({
    companyId,
    employeeId: forcedUserId,
    pis: normalizeDigits(body.pis),
    cpf: normalizeDigits(body.cpf),
    matricula: body.matricula == null ? null : String(body.matricula).trim() || null,
    rawData,
  });
  const resolvedUserId = match.userId ?? forcedUserId;

  logger.info({
    module: 'rep.ingest',
    action: 'PUNCH_RECEIVED',
    companyId,
    message: 'Batida REP recebida',
    meta: {
      device_id: deviceId,
      nsr: normalizeNsr(body.nsr),
      data_hora: ts.toISOString(),
      match_strategy: match.strategy,
      resolved_user_id: resolvedUserId,
      punch_hash: punchHash,
    },
  });

  const baseParams = [
    companyId,
    deviceId,
    normalizeDigits(body.pis),
    normalizeDigits(body.cpf),
    body.matricula == null ? null : String(body.matricula).trim() || null,
    body.nome_funcionario == null ? null : String(body.nome_funcionario).trim() || null,
    ts.toISOString(),
    body.tipo_marcacao == null ? 'E' : String(body.tipo_marcacao || 'E'),
    normalizeNsr(body.nsr),
    JSON.stringify(rawData),
    false,
    false,
    resolvedUserId,
    false,
  ];

  const hasPunchHashParam = await repIngestHasPunchHashParam();
  const sql = hasPunchHashParam
    ? `select public.rep_ingest_punch($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::timestamptz, $8::text, $9::bigint, $10::jsonb, $11::boolean, $12::boolean, $13::uuid, $14::boolean, $15::text) as result`
    : `select public.rep_ingest_punch($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::timestamptz, $8::text, $9::bigint, $10::jsonb, $11::boolean, $12::boolean, $13::uuid, $14::boolean) as result`;
  const params = hasPunchHashParam ? [...baseParams, punchHash] : baseParams;
  const result = await pool.query(sql, params);
  const payload = result.rows[0]?.result;
  const out =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : { success: false, error: 'rep_ingest_punch sem retorno' };

  logger.info({
    module: 'rep.ingest',
    action: 'REP_RPC_RESULT',
    companyId,
    message: 'Resultado RPC rep_ingest_punch',
    meta: {
      device_id: deviceId,
      nsr: normalizeNsr(body.nsr),
      punch_hash: punchHash,
      success: out.success !== false,
      duplicate: out.duplicate === true,
      user_not_found: out.user_not_found === true,
      time_record_id: out.time_record_id ?? null,
      rep_log_id: out.rep_log_id ?? null,
      promotion_error_code: out.promotion_error_code ?? null,
      error: out.error ?? null,
    },
  });

  if (out.rep_log_id) {
    logger.info({
      module: 'rep.ingest',
      action: 'REP_INSERT_RESULT',
      companyId,
      message: 'Registro persistido em rep_punch_logs',
      meta: {
        rep_log_id: out.rep_log_id,
        time_record_id: out.time_record_id ?? null,
        promoted: Boolean(out.time_record_id),
        user_not_found: out.user_not_found === true,
      },
    });
  }

  if (out.success !== false && out.time_record_id) {
    logger.info({
      module: 'rep.ingest',
      action: 'PROMOTION_SUCCESS',
      companyId,
      message: 'Batida promovida para time_records',
      meta: {
        rep_log_id: out.rep_log_id ?? null,
        time_record_id: out.time_record_id,
        device_id: deviceId,
        nsr: normalizeNsr(body.nsr),
      },
    });
  } else if (out.success !== false && out.user_not_found) {
    logger.warn({
      module: 'rep.ingest',
      action: 'PROMOTION_FAILURE',
      companyId,
      message: 'Batida em rep_punch_logs sem colaborador vinculado',
      meta: {
        rep_log_id: out.rep_log_id ?? null,
        device_id: deviceId,
        nsr: normalizeNsr(body.nsr),
        match_strategy: match.strategy,
        promotion_error_code: out.promotion_error_code ?? 'user_not_found',
      },
    });
  } else if (out.success === false) {
    logger.warn({
      module: 'rep.ingest',
      action: 'PUNCH_REJECTED',
      companyId,
      message: 'Batida rejeitada pelo RPC rep_ingest_punch',
      meta: {
        device_id: deviceId,
        error: out.error ?? null,
        punch_hash: punchHash,
      },
    });
  } else if (out.success !== false) {
    logger.info({
      module: 'rep.ingest',
      action: 'PUNCH_INSERTED',
      companyId,
      message: 'Batida inserida em rep_punch_logs',
      meta: {
        rep_log_id: out.rep_log_id ?? null,
        device_id: deviceId,
        duplicate: out.duplicate === true,
      },
    });
  }

  return { ...out, resolved_user_id: resolvedUserId };
}

async function processPunchBatch(
  list: RepPunchBody[],
  auth: RepDeviceAuth,
): Promise<{
  results: Array<Record<string, unknown>>;
  inserted: number;
  duplicates: number;
  errors: number;
  unresolved: number;
  promoted: RepPromotedRow[];
  migrationError: boolean;
}> {
  const results: Array<Record<string, unknown>> = [];
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  let unresolved = 0;
  const promoted: RepPromotedRow[] = [];
  let migrationError = false;

  for (const item of list) {
    const body = item && typeof item === 'object' ? item : {};
    const punchHash = punchHashFromBody(body);
    try {
      const result = await ingestRepPunch(body, auth);
      const duplicate = result.duplicate === true || String(result.error || '').includes('já importado');
      const success = result.success !== false || duplicate;
      const wasPromoted = Boolean(result.time_record_id);
      const userNotFound = result.user_not_found === true;

      if (success && duplicate) duplicates += 1;
      else if (success && wasPromoted) inserted += 1;
      else if (success && userNotFound) {
        unresolved += 1;
      } else if (success) inserted += 1;
      else errors += 1;

      const errMsg = typeof result.error === 'string' ? result.error : '';
      if (!success && isRepIngestMigrationError(errMsg)) {
        migrationError = true;
        logger.error({
          module: 'rep.ingest',
          action: 'REP_MIGRATION_REQUIRED',
          companyId: auth.companyId,
          message:
            'RPC rep_ingest_punch desatualizada no banco — aplique migrações 20260520350000+ (fix company_id uuid) e reinicie a API',
          meta: { error: errMsg, punch_hash: punchHash },
        });
      }

      if (success && wasPromoted && result.time_record_id) {
        const dataHora = String(body.data_hora || body.timestamp || '').trim();
        const userId =
          normalizeUuid(result.resolved_user_id) ??
          normalizeUuid(body.employee_id) ??
          normalizeUuid(body.user_id) ??
          normalizeUuid(result.user_id);
        if (userId && dataHora) {
          promoted.push({
            user_id: userId,
            data_hora: dataHora,
            nsr: normalizeNsr(body.nsr),
            time_record_id: String(result.time_record_id),
          });
        }
      }

      results.push({
        punch_hash: result.punch_hash ?? punchHash,
        success,
        duplicate,
        inserted: success && !duplicate && wasPromoted,
        unresolved: success && userNotFound,
        error: errMsg || undefined,
        rep_log_id: result.rep_log_id ?? null,
        time_record_id: result.time_record_id ?? null,
        user_not_found: userNotFound || undefined,
      });
    } catch (error) {
      errors += 1;
      const errMsg = error instanceof Error ? error.message : String(error);
      if (isRepIngestMigrationError(errMsg)) {
        migrationError = true;
        logger.error({
          module: 'rep.ingest',
          action: 'REP_MIGRATION_REQUIRED',
          companyId: auth.companyId,
          message:
            'RPC rep_ingest_punch desatualizada no banco — aplique migrações 20260520350000+ (fix company_id uuid) e reinicie a API',
          meta: { error: errMsg, punch_hash: punchHash },
        });
      }
      logger.error({
        module: 'rep.ingest',
        action: 'PUNCH_REJECTED',
        message: 'Exceção ao ingerir batida REP',
        error,
        meta: { punch_hash: punchHash },
      });
      results.push({
        punch_hash: punchHash,
        success: false,
        error: errMsg,
      });
    }
  }

  return { results, inserted, duplicates, errors, unresolved, promoted, migrationError };
}

export async function repPunchesController(req: Request, res: Response): Promise<void> {
  const auth = await requireRepDeviceAuthFromPunches(req, res);
  if (!auth) return;
  const list = Array.isArray(req.body?.punches) ? req.body.punches : [];
  if (list.length === 0) {
    json(res, 200, { ok: true, processed: 0, results: [] });
    return;
  }

  const t0 = Date.now();
  const MAX_BATCH = 50;
  if (list.length > MAX_BATCH) {
    logger.warn({
      module: 'rep.ingest',
      action: 'PUNCH_BATCH_TRUNCATED',
      message: `Lote de ${list.length} batidas truncado para ${MAX_BATCH}`,
      meta: { received: list.length, max_batch: MAX_BATCH },
    });
  }

  const chunk = list.slice(0, MAX_BATCH) as RepPunchBody[];
  const companyId = auth.companyId;
  const deviceId = auth.deviceId;

  logger.info({
    module: 'rep.ingest',
    action: 'REP_API_RECEIVED',
    companyId: companyId || null,
    message: 'Lote REP recebido via POST /api/rep/punches',
    meta: {
      device_id: deviceId,
      records_received: chunk.length,
      records_truncated: list.length > MAX_BATCH ? list.length - MAX_BATCH : 0,
    },
  });

  const { results, inserted, duplicates, errors, unresolved, promoted, migrationError } =
    await processPunchBatch(chunk, auth);

  const saved = inserted + duplicates + unresolved;
  logger.info({
    module: 'rep.ingest',
    action: 'REP_UPLOAD',
    message: '[REP UPLOAD]',
    companyId: companyId || null,
    meta: {
      device_id: deviceId,
      records: chunk.length,
      accepted: saved,
      rejected: errors,
      unresolved,
      migration_error: migrationError,
    },
  });
  if (migrationError) {
    logger.error({
      module: 'rep.ingest',
      action: 'MIGRATION_ERROR',
      message: '[MIGRATION ERROR] rep_ingest_punch — aplique migração 20260520350000+',
      companyId: companyId || null,
    });
  }
  await logRepPipelineTelemetry({
    deviceId,
    companyId: companyId || null,
    recordsReceived: chunk.length,
    recordsSaved: saved,
    recordsPromoted: promoted.length,
    recordsRejected: errors,
    executionTimeMs: Date.now() - t0,
    phase: 'promotion',
    extra: { inserted, duplicates, unresolved, migration_error: migrationError },
  });

  let allPromoted = [...promoted];
  if (companyId) {
    const pendingPromote = await promotePendingRepLogsAfterBatch(companyId, deviceId);
    if (pendingPromote.promoted.length > 0) {
      const seen = new Set(allPromoted.map((p) => `${p.user_id}|${p.data_hora}|${p.time_record_id ?? ''}`));
      for (const row of pendingPromote.promoted) {
        const key = `${row.user_id}|${row.data_hora}|${row.time_record_id ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allPromoted.push(row);
      }
    }
  }

  await logRepPipelineTelemetry({
    deviceId,
    companyId: companyId || null,
    recordsReceived: chunk.length,
    recordsSaved: saved,
    recordsPromoted: allPromoted.length,
    recordsRejected: errors,
    executionTimeMs: Date.now() - t0,
    phase: 'upload',
    extra: { inserted, duplicates, unresolved, migration_error: migrationError },
  });

  let calcDaysRecalculated = 0;
  if (allPromoted.length > 0 && companyId) {
    await enqueueRepTimesheetRecalcJobs(companyId, allPromoted);
    calcDaysRecalculated = await processRepCalcDayJobsImmediate(companyId, Math.max(allPromoted.length, 25));
    logger.info({
      module: 'rep.pipeline',
      action: 'REP_TIMESHEET',
      message: '[REP TIMESHEET]',
      companyId,
      meta: { jobs: allPromoted.length, dias_recalculados: calcDaysRecalculated },
    });
    await logRepPipelineTelemetry({
      deviceId,
      companyId,
      recordsReceived: allPromoted.length,
      recordsSaved: allPromoted.length,
      recordsPromoted: allPromoted.length,
      recordsRejected: 0,
      executionTimeMs: Date.now() - t0,
      phase: 'timesheet',
      extra: { calc_day_jobs_enqueued: allPromoted.length, dias_recalculados: calcDaysRecalculated },
    });
  }

  if (companyId) {
    await logRepPipelineDbDiagnostics(companyId);
  }

  json(res, 200, {
    ok: true,
    processed: chunk.length,
    received: list.length,
    truncated: list.length > MAX_BATCH,
    inserted,
    duplicates,
    errors,
    unresolved,
    migration_error: migrationError,
    timesheet_jobs_enqueued: allPromoted.length > 0 && companyId ? allPromoted.length : 0,
    timesheet_days_recalculated: calcDaysRecalculated,
    results,
  });
}

export async function repHeartbeatController(req: Request, res: Response): Promise<void> {
  const auth = await requireRepDeviceAuth(req, res);
  if (!auth) return;
  const now = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `update public.rep_devices
          set last_seen_at = $1::timestamptz,
              status_runtime = 'online',
              updated_at = $1::timestamptz
        where id::text = $2
          and company_id::text = $3`,
      [now, auth.deviceId, auth.companyId],
    );
    await client.query('commit');
    logger.info({
      module: 'rep.heartbeat',
      action: 'AGENT_HEARTBEAT',
      companyId: auth.companyId,
      message: 'Heartbeat REP recebido',
      meta: { device_id: auth.deviceId, last_seen_at: now },
    });
    json(res, 200, { ok: true, success: true, last_seen_at: now });
  } catch (error) {
    await client.query('rollback');
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    client.release();
  }
}

/** GET /api/rep/status?device_id= — teste de conexão (browser / sync job). */
export async function repStatusController(req: Request, res: Response): Promise<void> {
  const auth = await requireRepAdminCaller(req, res);
  if (!auth) return;

  const deviceId = String(req.query.device_id || '').trim();
  if (!deviceId) {
    json(res, 400, { ok: false, error: 'device_id é obrigatório' });
    return;
  }

  const result = await pool.query(
    `select id::text, company_id::text, nome_dispositivo, tipo_conexao, ip, porta, fabricante, modelo,
            provider_type, identifier_type, config_extra, status, ultima_sincronizacao, ativo
       from public.rep_devices
      where id::text = $1 and company_id::text = $2
      limit 1`,
    [deviceId, auth.companyId],
  );
  const device = result.rows[0] as Record<string, unknown> | undefined;
  if (!device) {
    json(res, 404, { ok: false, success: false, error: 'device_not_found' });
    return;
  }
  if (String(device.tipo_conexao || '') !== 'rede') {
    json(res, 400, { ok: false, message: 'Dispositivo não é do tipo rede (IP).' });
    return;
  }

  const ip = String(device.ip || '').trim();
  if (ip && isPrivateOrLocalIPv4(ip)) {
    json(res, 200, {
      ok: false,
      message:
        'Este relógio está na rede interna da empresa. Use o agente PontoWebDesk no computador da empresa ' +
        '(teste via agente ou «Sincronizar agora»). O teste direto pela internet não é possível.',
      httpStatus: 0,
      body: null,
    });
    return;
  }

  const port = Number(device.porta ?? 80);
  const baseUrl = `http://${ip}:${Number.isFinite(port) && port > 0 ? port : 80}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const probe = await fetch(baseUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    if (probe.ok) {
      json(res, 200, { ok: true, message: 'Conexão OK', httpStatus: probe.status, body: null });
      return;
    }
    json(res, 200, {
      ok: false,
      message: `Resposta HTTP ${probe.status}`,
      httpStatus: probe.status,
      body: null,
    });
  } catch (error) {
    clearTimeout(timeout);
    const msg = error instanceof Error ? error.message : String(error);
    json(res, 200, {
      ok: false,
      message: msg.includes('abort') ? 'Tempo esgotado ao contatar o relógio.' : msg,
      httpStatus: 0,
      body: null,
    });
  }
}

export async function repSyncStatusController(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId || req.query.device_id || '').trim();
  if (!deviceId) {
    json(res, 400, { ok: false, error: 'device_id é obrigatório' });
    return;
  }

  const tokenCompanyId = await repAdminCompanyId(req);
  const token = authHeaderToken(req);
  const agentAuth = await verifyRepAgentTokenVps(token, deviceId);
  if (!agentAuth.ok && !tokenCompanyId) {
    if (agentAuth.code === 'DEVICE_INACTIVE') {
      repAgentAuthDenied(res, agentAuth);
      return;
    }
    json(res, 401, { ok: false, success: false, error: 'unauthorized' });
    return;
  }

  const deviceCompanyId = await fetchRepDeviceCompanyId(deviceId);
  if (!deviceCompanyId) {
    json(res, 404, { ok: false, success: false, error: 'device_not_found' });
    return;
  }
  if (tokenCompanyId && deviceCompanyId !== tokenCompanyId) {
    json(res, 403, { ok: false, success: false, error: 'device_not_found' });
    return;
  }

  const companyId = deviceCompanyId;
  const params: unknown[] = [deviceId, companyId];
  const clauses = ['d.id::text = $1', 'd.company_id::text = $2'];
  const result = await pool.query(
    `select d.status_runtime, d.last_seen_at, d.ultima_sincronizacao,
            coalesce(cmd.pending, 0)::int as cmd_pending,
            coalesce(cmd.processing, 0)::int as cmd_processing,
            coalesce(cmd.error, 0)::int as cmd_error
       from public.rep_devices d
       left join lateral (
         select
           count(*) filter (where c.status = 'pending') as pending,
           count(*) filter (where c.status = 'processing') as processing,
           count(*) filter (where c.status = 'error' and c.updated_at > now() - interval '24 hours') as error
         from public.rep_device_commands c
        where c.device_id = d.id
          and c.created_at > now() - interval '24 hours'
       ) cmd on true
      where ${clauses.join(' and ')}
      limit 1`,
    params,
  );
  const row = result.rows[0];
  if (!row) {
    json(res, 404, { ok: false, success: false, error: 'device_not_found' });
    return;
  }
  const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null;
  const ageMs = lastSeen ? Date.now() - new Date(lastSeen).getTime() : Number.POSITIVE_INFINITY;
  const connection = ageMs < 180_000 ? 'online' : ageMs < 300_000 ? 'unstable' : 'offline';
  json(res, 200, {
    ok: true,
    success: true,
    online: connection !== 'offline',
    connection,
    pending: Number(row.cmd_pending ?? 0),
    processing: Number(row.cmd_processing ?? 0),
    sent: 0,
    error: Number(row.cmd_error ?? 0),
    device_status: connection === 'offline' ? String(row.status_runtime || 'unknown') : 'online',
    last_seen_at: lastSeen,
    last_heartbeat_at: lastSeen,
    last_sync_at: row.ultima_sincronizacao
      ? new Date(row.ultima_sincronizacao).toISOString()
      : null,
  });
}

export async function repForceSyncController(req: Request, res: Response): Promise<void> {
  const auth = await requireRepAdminCaller(req, res);
  if (!auth) return;
  const deviceId = String(req.params.deviceId || req.query.device_id || req.body?.device_id || '').trim();
  if (!deviceId) {
    json(res, 400, { ok: false, success: false, error: 'device_id é obrigatório' });
    return;
  }
  const result = await pool.query(
    `select 1 from public.rep_devices where id::text = $1 and company_id::text = $2 limit 1`,
    [deviceId, auth.companyId],
  );
  if (!result.rows[0]) {
    json(res, 404, { ok: false, success: false, error: 'device_not_found' });
    return;
  }

  const action = String(req.body?.action || '').trim();
  if (action === 'promote_pending') {
    req.body = {
      ...(req.body && typeof req.body === 'object' ? req.body : {}),
      p_company_id: auth.companyId,
      p_rep_device_id: deviceId,
    };
    await repPromotePendingController(req, res);
    return;
  }

  json(res, 200, {
    ok: true,
    success: true,
    message: 'Sincronização será executada pelo agente no próximo ciclo.',
  });
}

export async function repCommandsController(req: Request, res: Response): Promise<void> {
  if (req.method === 'POST') {
    const auth = await requireRepAdminCaller(req, res);
    if (!auth) return;
    const deviceId = String(req.body?.device_id || req.query.device_id || '').trim();
    const command = String(req.body?.command || '').trim() || 'test_connection';
    if (!deviceId) {
      json(res, 400, { ok: false, success: false, error: 'device_id é obrigatório' });
      return;
    }
    if (!ADMIN_REP_COMMANDS.has(command)) {
      json(res, 400, { ok: false, success: false, error: 'Comando não suportado' });
      return;
    }
    try {
      const device = await assertRepDeviceForAdmin(deviceId, auth.companyId);
      if (!device) {
        json(res, 404, { ok: false, success: false, error: 'device_not_found' });
        return;
      }
      if (command !== 'push_employee') {
        const active = await pool.query(
          `select id::text, status, execution_id::text
             from public.rep_device_commands
            where device_id::text = $1
              and command = $2
              and status in ('pending', 'processing')
            order by created_at asc
            limit 1`,
          [deviceId, command],
        );
        if (active.rows[0]) {
          json(res, 200, {
            ok: true,
            success: true,
            command_id: active.rows[0].id,
            status: active.rows[0].status,
            execution_id: active.rows[0].execution_id ?? null,
            reused: true,
          });
          return;
        }
      }
      if (command === 'test_connection') {
        await pool.query(
          `update public.rep_device_commands
              set status = 'cancelled',
                  execution_id = null,
                  result = '{"message":"Substituído por novo teste"}'::jsonb,
                  updated_at = now()
            where device_id::text = $1
              and command = 'test_connection'
              and status in ('pending', 'processing')`,
          [deviceId],
        );
      }
      const payload = req.body?.payload && typeof req.body.payload === 'object' && !Array.isArray(req.body.payload)
        ? { ...(req.body.payload as Record<string, unknown>), requested_by: auth.userId }
        : { requested_by: auth.userId };
      const inserted = await pool.query(
        `insert into public.rep_device_commands
            (company_id, device_id, command, status, execution_id, payload, created_at, updated_at)
         values ($1::uuid, $2::uuid, $3, 'pending', null, $4::jsonb, now(), now())
         returning id::text, status, execution_id::text, created_at::text`,
        [auth.companyId, deviceId, command, JSON.stringify(payload)],
      );
      const row = inserted.rows[0];
      logger.info({
        module: 'rep.commands',
        action: 'REP_COMMAND_CREATED',
        message: '[REP COMMAND CREATED]',
        companyId: auth.companyId,
        meta: {
          command_id: row.id,
          device_id: deviceId,
          command,
          payload,
        },
      });
      json(res, 200, {
        ok: true,
        success: true,
        command_id: row.id,
        status: row.status,
        execution_id: row.execution_id ?? null,
        created_at: row.created_at,
      });
      return;
    } catch (error) {
      logger.error({
        module: 'rep.commands',
        action: 'REP_COMMAND_ENQUEUE_FAILED',
        companyId: auth.companyId,
        message: 'Falha ao enfileirar comando REP',
        error,
        meta: { deviceId, command },
      });
      json(res, 500, {
        ok: false,
        success: false,
        error: 'command_enqueue_failed',
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
  }

  if (req.method === 'GET') {
    const token = authHeaderToken(req);
    const deviceId = String(req.query.device_id || '').trim();
    const agentAuth = deviceId ? await verifyRepAgentTokenVps(token, deviceId) : { ok: false as const, code: 'unauthorized' as const };
    if (agentAuth.ok) {
      if (!deviceId) {
        json(res, 200, { ok: true, success: true, commands: [], reason: 'device_id_required' });
        return;
      }
      const companyId = await fetchRepDeviceCompanyId(deviceId);
      if (!companyId) {
        json(res, 200, { ok: true, success: true, commands: [], reason: 'device_not_found' });
        return;
      }
      await pool.query(
        `update public.rep_device_commands
            set status = 'pending',
                execution_id = null,
                result = '{"message":"Reenfileirado após timeout do agente"}'::jsonb,
                updated_at = now()
          where company_id::text = $1
            and device_id::text = $2
            and status = 'processing'
            and execution_id is not null
            and updated_at < now() - ($3::text)::interval`,
        [companyId, deviceId, `${STUCK_COMMAND_PROCESSING_MS} milliseconds`],
      );
      const pending = await pool.query(
        `select id
           from public.rep_device_commands
          where company_id::text = $1
            and device_id::text = $2
            and status = 'pending'
          order by
            case when command = 'test_connection' then 0 else 1 end asc,
            created_at asc
          limit 10`,
        [companyId, deviceId],
      );
      const commands: unknown[] = [];
      for (const pendingRow of pending.rows) {
        const executionId = randomUUID();
        const claimed = await pool.query(
          `update public.rep_device_commands
              set status = 'processing',
                  execution_id = $2::uuid,
                  updated_at = now()
            where id = $1::uuid
              and status = 'pending'
            returning id::text, company_id::text, device_id::text, command, status, execution_id::text, payload, created_at::text, updated_at::text`,
          [pendingRow.id, executionId],
        );
        if (claimed.rows[0]) {
          const row = claimed.rows[0] as Record<string, unknown>;
          commands.push({
            ...row,
            command_hmac: signRepCommandRow(token, {
              id: String(row.id || ''),
              execution_id: String(row.execution_id || ''),
              command: String(row.command || ''),
              device_id: String(row.device_id || deviceId),
            }),
          });
        }
      }
      json(res, 200, { ok: true, success: true, commands });
      return;
    }
    if (!agentAuth.ok && agentAuth.code === 'DEVICE_INACTIVE') {
      repAgentAuthDenied(res, agentAuth);
      return;
    }

    const auth = await requireRepAdminCaller(req, res);
    if (!auth) return;
    const commandId = String(req.query.command_id || '').trim();
    const commandFilter = String(req.query.command || '').trim();
    const latest = String(req.query.latest || '') === 'true';
    const params: unknown[] = [auth.companyId];
    const clauses = ['company_id::text = $1'];
    if (deviceId) {
      params.push(deviceId);
      clauses.push(`device_id::text = $${params.length}`);
    }
    if (commandId) {
      params.push(commandId);
      clauses.push(`id::text = $${params.length}`);
    }
    if (commandFilter) {
      params.push(commandFilter);
      clauses.push(`command = $${params.length}`);
    }
    const limit = latest ? 1 : 20;
    const result = await pool.query(
      `select id::text, device_id::text, command, status, execution_id::text, result, created_at::text, updated_at::text
         from public.rep_device_commands
        where ${clauses.join(' and ')}
        order by created_at desc
        limit ${limit}`,
      params,
    );
    json(res, 200, latest ? { ok: true, success: true, command: result.rows[0] ?? null } : { ok: true, success: true, commands: result.rows });
    return;
  }

  json(res, 405, { ok: false, success: false, error: 'method_not_allowed' });
}

export async function repCollectController(req: Request, res: Response): Promise<void> {
  req.body = {
    ...((req.body && typeof req.body === 'object') ? req.body : {}),
    command: 'collect_punches',
    payload: {
      start_date: req.body?.start_date,
      end_date: req.body?.end_date,
      receive_scope: req.body?.receive_scope ?? 'date_range',
    },
  };
  await repCommandsController(req, res);
}

export async function repExchangeController(req: Request, res: Response): Promise<void> {
  const auth = await requireRepAdminCaller(req, res);
  if (!auth) return;
  const deviceId = String(req.body?.device_id || '').trim();
  const op = String(req.body?.op || '').trim();
  if (!deviceId || !op) {
    json(res, 400, { ok: false, success: false, error: 'device_id e op são obrigatórios' });
    return;
  }
  if (!REP_EXCHANGE_COMMANDS.has(op)) {
    json(res, 400, { ok: false, success: false, error: 'op inválido' });
    return;
  }
  const device = await assertRepDeviceForAdmin(deviceId, auth.companyId);
  if (!device) {
    json(res, 404, { ok: false, success: false, error: 'device_not_found' });
    return;
  }
  if (String(device.tipo_conexao || '') !== 'rede') {
    json(res, 400, { ok: false, success: false, error: 'Dispositivo deve ser do tipo rede (IP).' });
    return;
  }
  req.body = {
    device_id: deviceId,
    command: op,
    payload: {
      clock: parseJsonObject(req.body?.clock),
      op,
    },
  };
  await repCommandsController(req, res);
}

export async function repPushEmployeeController(req: Request, res: Response): Promise<void> {
  const auth = await requireRepAdminCaller(req, res);
  if (!auth) return;
  const deviceId = String(req.body?.device_id || '').trim();
  const userId = String(req.body?.user_id || '').trim();
  if (!deviceId || !userId) {
    json(res, 400, { ok: false, success: false, error: 'device_id e user_id são obrigatórios' });
    return;
  }
  try {
    const device = await assertRepDeviceForAdmin(deviceId, auth.companyId);
    if (!device) {
      json(res, 404, { ok: false, success: false, error: 'device_not_found' });
      return;
    }
    if (String(device.tipo_conexao || '') !== 'rede') {
      json(res, 400, { ok: false, success: false, error: 'Dispositivo deve ser do tipo rede (IP).' });
      return;
    }
    const employee = await fetchEmployeeForRepPush(userId, auth.companyId);
    if (!employee) {
      json(res, 404, {
        ok: false,
        success: false,
        error: 'Funcionário não encontrado ou inativo/excluído',
      });
      return;
    }
    const role = String(employee.role || '').toLowerCase();
    if (!['employee', 'hr', 'admin'].includes(role)) {
      json(res, 403, { ok: false, success: false, error: 'Este perfil não pode ser enviado ao relógio' });
      return;
    }
    req.body = {
      device_id: deviceId,
      command: 'push_employee',
      payload: {
        employee: {
          id: employee.id,
          nome: employee.nome,
          cpf: employee.cpf ?? null,
          pis: employee.pis ?? null,
          matricula: employee.matricula ?? null,
        },
      },
    };
    await repCommandsController(req, res);
  } catch (error) {
    logger.error({
      module: 'rep.controller',
      action: 'REP_PUSH_EMPLOYEE_FAILED',
      message: 'Falha ao enfileirar push_employee',
      userId: auth.userId,
      companyId: auth.companyId,
      error,
      meta: { deviceId, employeeUserId: userId },
    });
    json(res, 500, {
      ok: false,
      success: false,
      error: 'push_employee_failed',
      message: 'Não foi possível enfileirar o envio do colaborador ao relógio.',
    });
  }
}

export async function repCommandResultController(req: Request, res: Response): Promise<void> {
  const auth = await requireRepDeviceAuth(req, res);
  if (!auth) return;
  const commandId = String(req.body?.command_id || '').trim();
  const executionId = String(req.body?.execution_id || '').trim();
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!commandId || !executionId) {
    json(res, 400, { ok: false, success: false, error: 'command_id e execution_id são obrigatórios' });
    return;
  }
  if (status !== 'done' && status !== 'error') {
    json(res, 400, { ok: false, success: false, error: 'status inválido' });
    return;
  }
  const existing = await pool.query(
    `select c.status, c.execution_id::text
       from public.rep_device_commands c
       join public.rep_devices d on d.id = c.device_id
      where c.id::text = $1
        and d.id::text = $2
        and d.company_id::text = $3
      limit 1`,
    [commandId, auth.deviceId, auth.companyId],
  );
  const row = existing.rows[0];
  if (!row) {
    json(res, 404, { ok: false, success: false, error: 'command_not_found' });
    return;
  }
  if (['done', 'error', 'cancelled'].includes(String(row.status))) {
    json(res, 200, { ok: true, success: true, idempotent: true });
    return;
  }
  if (String(row.execution_id || '') !== executionId) {
    json(res, 200, { ok: true, success: true, ignored: true, reason: 'stale_execution_id' });
    return;
  }
  const updated = await pool.query(
    `update public.rep_device_commands c
        set status = $3,
            result = $4::jsonb,
            updated_at = now()
       from public.rep_devices d
      where c.id::text = $1
        and c.execution_id::text = $2
        and c.status = 'processing'
        and d.id = c.device_id
        and d.id::text = $5
        and d.company_id::text = $6
      returning c.id::text`,
    [commandId, executionId, status, JSON.stringify(req.body?.result ?? null), auth.deviceId, auth.companyId],
  );
  if (!updated.rows[0]) {
    json(res, 200, { ok: true, success: true, ignored: true, reason: 'execution_mismatch_or_already_finished' });
    return;
  }
  json(res, 200, { ok: true, success: true });
}

/** POST /api/rep/promote-pending — consolida rep_punch_logs → time_records (fallback se /data/rpc bloquear). */
export async function repPromotePendingController(req: Request, res: Response): Promise<void> {
  const tokenCompanyId = await repAdminCompanyId(req);
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const repDeviceId = String(body.p_rep_device_id || '').trim();
  if (!repDeviceId) {
    json(res, 400, { ok: false, error: 'p_rep_device_id é obrigatório' });
    return;
  }

  const token = authHeaderToken(req);
  const agentAuth = await verifyRepAgentTokenVps(token, repDeviceId);
  if (!agentAuth.ok && !tokenCompanyId) {
    if (agentAuth.code === 'DEVICE_INACTIVE') {
      repAgentAuthDenied(res, agentAuth);
      return;
    }
    json(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  const companyId = await fetchRepDeviceCompanyId(repDeviceId);
  if (!companyId) {
    json(res, 404, { ok: false, error: 'device_not_found' });
    return;
  }
  if (tokenCompanyId && companyId !== tokenCompanyId) {
    json(res, 403, { ok: false, error: 'company_id inválido' });
    return;
  }

  try {
    const exists = await repRpcExistsInDatabase('rep_promote_pending_rep_punch_logs');
    if (!exists) {
      json(res, 503, {
        ok: false,
        error: 'rpc_missing',
        message: 'Função rep_promote_pending_rep_punch_logs não encontrada no banco. Aplique as migrações Supabase.',
      });
      return;
    }

    const rpcBody = { ...body, p_company_id: companyId, p_rep_device_id: repDeviceId };
    const data = await executeRepRpcProxy('rep_promote_pending_rep_punch_logs', rpcBody, companyId);
    json(res, 200, { ok: true, data, error: null });
  } catch (error) {
    logger.error({
      module: 'rep.promote',
      action: 'REP_PROMOTE_PENDING_FAILED',
      message: 'Falha ao consolidar rep_punch_logs',
      companyId,
      error,
      meta: { rep_device_id: repDeviceId },
    });
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'promote_failed',
    });
  }
}
