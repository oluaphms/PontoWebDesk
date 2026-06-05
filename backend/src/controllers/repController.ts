import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/index.js';

type RepPunchBody = Record<string, unknown>;

const REP_DEVICE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(res: Response, status: number, body: Record<string, unknown>): void {
  res.status(status).json(body);
}

function authHeaderToken(req: Request): string {
  const raw = String(req.headers.authorization || req.headers['x-rep-api-key'] || req.headers['x-api-key'] || '').trim();
  return raw.replace(/^Bearer\s+/i, '').trim();
}

function hasValidApiKey(req: Request): boolean {
  const apiKey = String(process.env.API_KEY || process.env.REP_API_KEY || '').trim();
  return Boolean(apiKey && authHeaderToken(req) === apiKey);
}

function jwtCompanyId(req: Request): string {
  const secret = String(process.env.JWT_SECRET || '').trim();
  const token = authHeaderToken(req);
  if (!secret || !token) return '';
  try {
    const decoded = jwt.verify(token, secret) as { companyId?: unknown; role?: unknown };
    const role = String(decoded.role || '').trim().toLowerCase();
    if (role !== 'admin' && role !== 'hr') return '';
    return String(decoded.companyId || '').trim();
  } catch {
    return '';
  }
}

function requireRepAuth(req: Request, res: Response): boolean {
  if (hasValidApiKey(req)) return true;
  json(res, 401, { ok: false, success: false, error: 'unauthorized' });
  return false;
}

function normalizeUuid(value: unknown): string | null {
  const raw = String(value || '').trim();
  return REP_DEVICE_UUID_RE.test(raw) ? raw : null;
}

function normalizeDigits(value: unknown): string | null {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
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

function buildRawData(body: RepPunchBody, tsIso: string, punchHash: string | null): Record<string, unknown> {
  const incoming = body.raw_data && typeof body.raw_data === 'object' && !Array.isArray(body.raw_data)
    ? (body.raw_data as Record<string, unknown>)
    : {};
  const identifiers = [normalizeDigits(body.pis), normalizeDigits(body.cpf)].filter(Boolean);
  return {
    ...incoming,
    source: 'REP',
    ingest: 'vps-rep-punch',
    company_id: body.company_id ?? null,
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

async function ingestRepPunch(body: RepPunchBody): Promise<Record<string, unknown>> {
  const companyId = String(body.company_id || body.companyId || '').trim();
  const dataHoraRaw = String(body.data_hora || body.timestamp || '').trim();
  if (!companyId || !dataHoraRaw) {
    return { success: false, error: 'company_id e data_hora são obrigatórios' };
  }

  const ts = new Date(dataHoraRaw);
  if (Number.isNaN(ts.getTime())) {
    return { success: false, error: 'data_hora inválido' };
  }

  const punchHash = punchHashFromBody(body);
  const rawData = buildRawData(body, ts.toISOString(), punchHash);
  const baseParams = [
    companyId,
    normalizeUuid(body.device_id),
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
    normalizeUuid(body.employee_id) ?? normalizeUuid(body.user_id),
    true,
  ];

  const hasPunchHashParam = await repIngestHasPunchHashParam();
  const sql = hasPunchHashParam
    ? `select public.rep_ingest_punch($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::timestamptz, $8::text, $9::bigint, $10::jsonb, $11::boolean, $12::boolean, $13::uuid, $14::boolean, $15::text) as result`
    : `select public.rep_ingest_punch($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::timestamptz, $8::text, $9::bigint, $10::jsonb, $11::boolean, $12::boolean, $13::uuid, $14::boolean) as result`;
  const params = hasPunchHashParam ? [...baseParams, punchHash] : baseParams;
  const result = await pool.query(sql, params);
  const payload = result.rows[0]?.result;
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : { success: false, error: 'rep_ingest_punch sem retorno' };
}

export async function repPunchesController(req: Request, res: Response): Promise<void> {
  if (!requireRepAuth(req, res)) return;
  const list = Array.isArray(req.body?.punches) ? req.body.punches : [];
  if (list.length === 0) {
    json(res, 200, { ok: true, processed: 0, results: [] });
    return;
  }
  if (list.length > 50) {
    json(res, 200, { ok: true, degraded: true, retry_after: 60_000, results: [] });
    return;
  }

  const results: Array<Record<string, unknown>> = [];
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  for (const item of list) {
    const body = item && typeof item === 'object' ? (item as RepPunchBody) : {};
    const punchHash = punchHashFromBody(body);
    try {
      const result = await ingestRepPunch(body);
      const duplicate = result.duplicate === true || String(result.error || '').includes('já importado');
      const success = result.success !== false || duplicate;
      if (success && duplicate) duplicates += 1;
      else if (success) inserted += 1;
      else errors += 1;
      results.push({
        punch_hash: result.punch_hash ?? punchHash,
        success,
        duplicate,
        inserted: success && !duplicate,
        error: typeof result.error === 'string' ? result.error : undefined,
        rep_log_id: result.rep_log_id ?? null,
        time_record_id: result.time_record_id ?? null,
      });
    } catch (error) {
      errors += 1;
      results.push({
        punch_hash: punchHash,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  json(res, 200, { ok: true, processed: list.length, inserted, duplicates, errors, results });
}

export async function repHeartbeatController(req: Request, res: Response): Promise<void> {
  if (!requireRepAuth(req, res)) return;
  const deviceId = String(req.params.deviceId || req.body?.device_id || req.query.device_id || '').trim();
  if (!deviceId) {
    json(res, 400, { ok: false, error: 'device_id é obrigatório' });
    return;
  }
  const companyId = String(req.body?.company_id || req.query.company_id || '').trim();
  const now = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const params: unknown[] = [now, deviceId];
    let scope = 'id::text = $2';
    if (companyId) {
      params.push(companyId);
      scope += ' and company_id::text = $3';
    }
    await client.query(
      `update public.rep_devices
          set last_seen_at = $1::timestamptz,
              status_runtime = 'online',
              updated_at = $1::timestamptz
        where ${scope}`,
      params,
    );
    await client.query('commit');
    json(res, 200, { ok: true, success: true, last_seen_at: now });
  } catch (error) {
    await client.query('rollback');
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    client.release();
  }
}

export async function repSyncStatusController(req: Request, res: Response): Promise<void> {
  const tokenCompanyId = jwtCompanyId(req);
  if (!hasValidApiKey(req) && !tokenCompanyId) {
    json(res, 401, { ok: false, success: false, error: 'unauthorized' });
    return;
  }
  const deviceId = String(req.params.deviceId || req.query.device_id || '').trim();
  if (!deviceId) {
    json(res, 400, { ok: false, error: 'device_id é obrigatório' });
    return;
  }
  const params: unknown[] = [deviceId];
  const clauses = ['id::text = $1'];
  if (tokenCompanyId) {
    params.push(tokenCompanyId);
    clauses.push(`company_id::text = $${params.length}`);
  }
  const result = await pool.query(
    `select status_runtime, last_seen_at
       from public.rep_devices
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
  const connection = ageMs < 60_000 ? 'online' : ageMs < 300_000 ? 'unstable' : 'offline';
  json(res, 200, {
    ok: true,
    success: true,
    online: connection !== 'offline',
    connection,
    pending: 0,
    sent: 0,
    error: 0,
    device_status: connection === 'offline' ? String(row.status_runtime || 'unknown') : 'online',
    last_seen_at: lastSeen,
    last_heartbeat_at: lastSeen,
  });
}

export async function repEmptyCommandsController(req: Request, res: Response): Promise<void> {
  if (!requireRepAuth(req, res)) return;
  json(res, 200, { ok: true, success: true, commands: [] });
}
