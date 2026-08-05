import type { Response } from 'express';
import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { authUserId, isAdminOrHr, normalizeRole, requireCompanyId } from '../utils/authContext.js';

type ManualAdjustmentBody = {
  employeeId?: unknown;
  type?: unknown;
  minutes?: unknown;
  reason?: unknown;
  date?: unknown;
};

type FlowRequestBody = {
  employeeId?: unknown;
  minutes?: unknown;
  reason?: unknown;
  date?: unknown;
  requestedDate?: unknown;
};

type ReviewBody = {
  requestId?: unknown;
  approve?: unknown;
  reason?: unknown;
};

type RequestFlowType = 'overtime_request' | 'time_bank_compensation';

function requestId(req: AuthedRequest): string | null {
  const header = req.headers['x-correlation-id'] ?? req.headers['x-request-id'];
  return Array.isArray(header) ? String(header[0] ?? '') || null : header ? String(header) : null;
}

function toYmd(raw: unknown): string {
  const s = String(raw ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

function normalizeLedgerType(raw: unknown): 'CREDIT' | 'DEBIT' {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === 'debit' || value === 'debito' || value === 'débito' ? 'DEBIT' : 'CREDIT';
}

function parsePositiveMinutes(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function toBoolean(raw: unknown, fallback = true): boolean {
  if (typeof raw === 'boolean') return raw;
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['true', '1', 'yes', 'sim'].includes(text)) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(text)) return false;
  return fallback;
}

function assertHrRole(req: AuthedRequest, res: Response): { userId: string; companyId: string } | null {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return null;
  const userId = authUserId(req.auth);
  if (!userId) {
    res.status(401).json({ ok: false, error: 'missing_user', code: 'AUTH_MISSING_USER' });
    return null;
  }
  if (!isAdminOrHr(req.auth?.role)) {
    res.status(403).json({ ok: false, error: 'forbidden', code: 'BANK_HOURS_FORBIDDEN' });
    return null;
  }
  return { userId, companyId };
}

async function ensureEmployeeInCompany(employeeId: string, companyId: string): Promise<boolean> {
  const result = await pool.query(
    `select 1
       from public.users
      where id::text = $1
        and company_id::text = $2
      limit 1`,
    [employeeId, companyId],
  );
  return (result.rowCount ?? 0) > 0;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function flowToLedgerType(flow: RequestFlowType): 'CREDIT' | 'DEBIT' {
  return flow === 'overtime_request' ? 'CREDIT' : 'DEBIT';
}

function flowToSource(flow: RequestFlowType): 'EXTRA' | 'MANUAL' {
  return flow === 'overtime_request' ? 'EXTRA' : 'MANUAL';
}

function flowLabel(flow: RequestFlowType): string {
  return flow === 'overtime_request' ? 'hora extra' : 'compensação';
}

async function createFlowRequestController(
  req: AuthedRequest,
  res: Response,
  flow: RequestFlowType,
): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  const userId = authUserId(req.auth);
  if (!userId) {
    res.status(401).json({ ok: false, error: 'missing_user', code: 'AUTH_MISSING_USER' });
    return;
  }
  const body = (req.body ?? {}) as FlowRequestBody;
  const employeeId = String(body.employeeId ?? userId).trim();
  const minutes = parsePositiveMinutes(body.minutes);
  const reason = String(body.reason ?? '').trim();
  const date = toYmd(body.date ?? body.requestedDate);

  if (!isAdminOrHr(req.auth?.role) && employeeId !== userId) {
    res.status(403).json({ ok: false, error: 'forbidden', code: 'BANK_HOURS_FLOW_FORBIDDEN' });
    return;
  }
  if (!employeeId || minutes <= 0 || !reason) {
    res.status(400).json({
      ok: false,
      error: 'invalid_payload',
      code: 'BANK_HOURS_FLOW_INVALID_PAYLOAD',
      message: 'employeeId, minutes e reason são obrigatórios.',
    });
    return;
  }
  if (!(await ensureEmployeeInCompany(employeeId, companyId))) {
    res.status(404).json({ ok: false, error: 'employee_not_found', code: 'BANK_HOURS_FLOW_EMPLOYEE_NOT_FOUND' });
    return;
  }

  try {
    const meta = {
      flow,
      requested_minutes: minutes,
      requested_date: date,
      request_origin: 'bank_hours_api',
      requested_by: userId,
      request_id: requestId(req),
      approved: false,
    };

    const reqInsert = await pool.query(
      `insert into public.requests
        (user_id, company_id, type, status, reason, metadata, created_at, updated_at)
       values
        ($1::uuid, $2::text, $3::text, 'pending', $4::text, $5::jsonb, now(), now())
       returning id::text, user_id::text, company_id::text, type, status, reason, metadata, created_at::text`,
      [employeeId, companyId, flow, reason, JSON.stringify(meta)],
    );
    const requestRow = reqInsert.rows[0];
    logger.info({
      module: 'bank-hours.controller',
      action: 'BANK_HOURS_FLOW_REQUEST_CREATED',
      message: `Solicitação de ${flowLabel(flow)} criada`,
      requestId: requestId(req) ?? undefined,
      userId,
      companyId,
      meta: { flow, requestRowId: requestRow?.id ?? null, employeeId, minutes, date },
    });
    res.status(201).json({ ok: true, data: requestRow });
  } catch (error) {
    logger.error({
      module: 'bank-hours.controller',
      action: 'BANK_HOURS_FLOW_REQUEST_FAILED',
      message: `Falha ao criar solicitação de ${flowLabel(flow)}`,
      requestId: requestId(req) ?? undefined,
      userId,
      companyId,
      error,
      meta: { flow, employeeId, minutes, date },
    });
    res.status(500).json({ ok: false, error: 'bank_hours_flow_request_failed' });
  }
}

async function reviewFlowRequestController(
  req: AuthedRequest,
  res: Response,
  flow: RequestFlowType,
): Promise<void> {
  const scope = assertHrRole(req, res);
  if (!scope) return;
  const body = (req.body ?? {}) as ReviewBody;
  const requestIdBody = String(body.requestId ?? '').trim();
  const approve = toBoolean(body.approve, true);
  const reason = String(body.reason ?? '').trim();

  if (!requestIdBody) {
    res.status(400).json({
      ok: false,
      error: 'invalid_payload',
      code: 'BANK_HOURS_REVIEW_INVALID_PAYLOAD',
      message: 'requestId é obrigatório.',
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const reqRow = await client.query(
      `select id::text, user_id::text, company_id::text, type, status, reason, metadata
         from public.requests
        where id::text = $1::text
          and company_id::text = $2::text
          and type = $3::text
        limit 1`,
      [requestIdBody, scope.companyId, flow],
    );
    if ((reqRow.rowCount ?? 0) === 0) {
      await client.query('rollback');
      res.status(404).json({ ok: false, error: 'request_not_found', code: 'BANK_HOURS_REQUEST_NOT_FOUND' });
      return;
    }

    const row = reqRow.rows[0] as {
      id: string;
      user_id: string;
      company_id: string;
      type: string;
      status: string;
      reason: string | null;
      metadata: unknown;
    };
    const metadata = parseMetadata(row.metadata);
    const requestedMinutes = parsePositiveMinutes(metadata.requested_minutes);
    const requestedDate = toYmd(metadata.requested_date);

    if (requestedMinutes <= 0) {
      await client.query('rollback');
      res.status(400).json({
        ok: false,
        error: 'invalid_request_metadata',
        code: 'BANK_HOURS_REQUEST_METADATA_INVALID',
        message: 'Solicitação sem requested_minutes válido em metadata.',
      });
      return;
    }

    await client.query(
      `update public.requests
          set status = $1::text,
              reason = case
                when $2::text <> '' then coalesce(reason, '') || E'\n[review] ' || $2::text
                else reason
              end,
              metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = now()
        where id::text = $4::text`,
      [
        approve ? 'approved' : 'rejected',
        reason,
        JSON.stringify({
          approved: approve,
          reviewed_by: scope.userId,
          reviewed_at: new Date().toISOString(),
          review_reason: reason || null,
        }),
        requestIdBody,
      ],
    );

    let ledgerInsertedId: string | null = null;
    if (approve) {
      const insertedLedger = await client.query(
        `insert into public.bank_hours_ledger
          (employee_id, company_id, date, minutes, type, source, expires_at, used_minutes, meta)
         values
          ($1::uuid, $2::text, $3::date, $4::int, $5::text, $6::text, null, 0, $7::jsonb)
         returning id::text`,
        [
          row.user_id,
          row.company_id,
          requestedDate,
          requestedMinutes,
          flowToLedgerType(flow),
          flowToSource(flow),
          JSON.stringify({
            flow,
            request_row_id: requestIdBody,
            approved: true,
            approved_by: scope.userId,
            approved_at: new Date().toISOString(),
            review_reason: reason || null,
            requested_by: metadata.requested_by ?? row.user_id,
            request_id: requestId(req),
          }),
        ],
      );
      ledgerInsertedId = String(insertedLedger.rows[0]?.id ?? '');
    }

    await client.query('commit');
    logger.info({
      module: 'bank-hours.controller',
      action: 'BANK_HOURS_FLOW_REVIEWED',
      message: `Solicitação de ${flowLabel(flow)} revisada`,
      requestId: requestId(req) ?? undefined,
      userId: scope.userId,
      companyId: scope.companyId,
      meta: {
        flow,
        requestId: requestIdBody,
        approved: approve,
        ledgerInsertedId,
        employeeId: row.user_id,
      },
    });
    res.json({
      ok: true,
      data: {
        requestId: requestIdBody,
        status: approve ? 'approved' : 'rejected',
        flow,
        ledgerInsertedId,
      },
    });
  } catch (error) {
    await client.query('rollback');
    logger.error({
      module: 'bank-hours.controller',
      action: 'BANK_HOURS_FLOW_REVIEW_FAILED',
      message: `Falha ao revisar solicitação de ${flowLabel(flow)}`,
      requestId: requestId(req) ?? undefined,
      userId: scope.userId,
      companyId: scope.companyId,
      error,
      meta: { flow, requestId: requestIdBody, approve },
    });
    res.status(500).json({ ok: false, error: 'bank_hours_flow_review_failed' });
  } finally {
    client.release();
  }
}

export async function listPendingFlowRequestsController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  const role = normalizeRole(req.auth?.role);
  const requesterId = authUserId(req.auth);
  const status = String(req.query.status ?? 'pending').trim().toLowerCase();
  const flow = String(req.query.flow ?? '').trim().toLowerCase();

  const params: unknown[] = [companyId];
  const conditions: string[] = ['company_id::text = $1'];

  if (!isAdminOrHr(role)) {
    params.push(requesterId);
    conditions.push(`user_id::text = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`lower(status) = $${params.length}`);
  }

  if (flow === 'overtime' || flow === 'overtime_request') {
    params.push('overtime_request');
    conditions.push(`type = $${params.length}`);
  } else if (flow === 'compensation' || flow === 'time_bank_compensation') {
    params.push('time_bank_compensation');
    conditions.push(`type = $${params.length}`);
  } else {
    conditions.push(`type in ('overtime_request', 'time_bank_compensation')`);
  }

  try {
    const data = await pool.query(
      `select
         id::text,
         user_id::text,
         company_id::text,
         type,
         status,
         reason,
         metadata,
         created_at::text,
         updated_at::text
       from public.requests
       where ${conditions.join(' and ')}
       order by created_at desc
       limit 1000`,
      params,
    );
    res.json({ ok: true, data: data.rows });
  } catch (error) {
    logger.error({
      module: 'bank-hours.controller',
      action: 'BANK_HOURS_PENDING_LIST_FAILED',
      message: 'Falha ao listar pendências de banco de horas',
      requestId: requestId(req) ?? undefined,
      userId: requesterId,
      companyId,
      error,
      meta: { status, flow },
    });
    res.status(500).json({ ok: false, error: 'bank_hours_pending_list_failed' });
  }
}

export async function listLedgerSummaryController(req: AuthedRequest, res: Response): Promise<void> {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;
  const role = normalizeRole(req.auth?.role);
  const requesterId = authUserId(req.auth);
  const employeeIdQuery = String(req.query.employeeId ?? req.query.userId ?? '').trim();
  const month = String(req.query.month ?? '').trim().slice(0, 7);
  const monthStart = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : '';
  const monthEnd = /^\d{4}-\d{2}$/.test(month) ? `${month}-31` : '';

  let employeeIdFilter = employeeIdQuery;
  if (!isAdminOrHr(role)) {
    employeeIdFilter = requesterId;
  }

  const params: unknown[] = [companyId];
  let where = 'where l.company_id::text = $1';
  if (employeeIdFilter) {
    params.push(employeeIdFilter);
    where += ` and l.employee_id::text = $${params.length}`;
  }
  if (monthStart && monthEnd) {
    params.push(monthStart);
    where += ` and l.date >= $${params.length}::date`;
    params.push(monthEnd);
    where += ` and l.date <= $${params.length}::date`;
  }

  const sql = `
    with ledger as (
      select
        l.employee_id::text as employee_id,
        l.date::text as date,
        l.type,
        l.minutes,
        l.used_minutes,
        l.source,
        l.created_at
      from public.bank_hours_ledger l
      ${where}
    )
    select
      employee_id,
      count(*)::int as movement_count,
      coalesce(sum(case when type = 'CREDIT' then greatest(minutes - used_minutes, 0) else 0 end), 0)::int as credit_available_minutes,
      coalesce(sum(case when type = 'DEBIT' then minutes else 0 end), 0)::int as debit_minutes,
      (
        coalesce(sum(case when type = 'CREDIT' then greatest(minutes - used_minutes, 0) else 0 end), 0)
        - coalesce(sum(case when type = 'DEBIT' then minutes else 0 end), 0)
      )::int as balance_minutes,
      max(date)::text as last_movement_date
    from ledger
    group by employee_id
    order by balance_minutes desc, employee_id asc
  `;

  try {
    const data = await pool.query(sql, params);
    logger.info({
      module: 'bank-hours.controller',
      action: 'BANK_HOURS_SUMMARY_LIST',
      message: 'Resumo do ledger consultado',
      requestId: requestId(req) ?? undefined,
      userId: requesterId,
      companyId,
      meta: {
        role,
        employeeIdFilter: employeeIdFilter || null,
        month: month || null,
        rows: data.rowCount ?? data.rows.length,
      },
    });
    res.json({ ok: true, data: data.rows });
  } catch (error) {
    logger.error({
      module: 'bank-hours.controller',
      action: 'BANK_HOURS_SUMMARY_LIST_FAILED',
      message: 'Falha ao listar resumo do ledger',
      requestId: requestId(req) ?? undefined,
      userId: requesterId,
      companyId,
      error,
      meta: { employeeIdFilter: employeeIdFilter || null, month: month || null },
    });
    res.status(500).json({ ok: false, error: 'bank_hours_summary_failed' });
  }
}

export async function createManualAdjustmentController(req: AuthedRequest, res: Response): Promise<void> {
  const scope = assertHrRole(req, res);
  if (!scope) return;
  const body = (req.body ?? {}) as ManualAdjustmentBody;
  const employeeId = String(body.employeeId ?? '').trim();
  const type = normalizeLedgerType(body.type);
  const minutes = parsePositiveMinutes(body.minutes);
  const reason = String(body.reason ?? '').trim();
  const date = toYmd(body.date);

  if (!employeeId || minutes <= 0 || !reason) {
    res.status(400).json({
      ok: false,
      error: 'invalid_payload',
      code: 'BANK_HOURS_MANUAL_INVALID_PAYLOAD',
      message: 'employeeId, minutes e reason são obrigatórios.',
    });
    return;
  }

  if (!(await ensureEmployeeInCompany(employeeId, scope.companyId))) {
    res.status(404).json({
      ok: false,
      error: 'employee_not_found',
      code: 'BANK_HOURS_MANUAL_EMPLOYEE_NOT_FOUND',
    });
    return;
  }

  try {
    const inserted = await pool.query(
      `insert into public.bank_hours_ledger
        (employee_id, company_id, date, minutes, type, source, expires_at, used_minutes, meta)
       values
        ($1::uuid, $2::text, $3::date, $4::int, $5::text, 'MANUAL', null, 0, $6::jsonb)
       returning id::text, employee_id::text, company_id::text, date::text, minutes, type, source, created_at::text`,
      [
        employeeId,
        scope.companyId,
        date,
        minutes,
        type,
        JSON.stringify({
          reason,
          requested_by: scope.userId,
          request_id: requestId(req),
          action: 'manual_adjustment',
        }),
      ],
    );
    logger.info({
      module: 'bank-hours.controller',
      action: 'BANK_HOURS_MANUAL_ADJUSTMENT_CREATED',
      message: 'Ajuste manual de banco de horas criado',
      requestId: requestId(req) ?? undefined,
      userId: scope.userId,
      companyId: scope.companyId,
      meta: {
        employeeId,
        minutes,
        type,
        date,
        reason,
        ledgerId: inserted.rows[0]?.id ?? null,
      },
    });
    res.status(201).json({ ok: true, data: inserted.rows[0] });
  } catch (error) {
    logger.error({
      module: 'bank-hours.controller',
      action: 'BANK_HOURS_MANUAL_ADJUSTMENT_FAILED',
      message: 'Falha ao criar ajuste manual',
      requestId: requestId(req) ?? undefined,
      userId: scope.userId,
      companyId: scope.companyId,
      error,
      meta: { employeeId, minutes, type, date },
    });
    res.status(500).json({ ok: false, error: 'bank_hours_manual_adjustment_failed' });
  }
}

export async function requestCompensationController(req: AuthedRequest, res: Response): Promise<void> {
  await createFlowRequestController(req, res, 'time_bank_compensation');
}

export async function requestOvertimeController(req: AuthedRequest, res: Response): Promise<void> {
  await createFlowRequestController(req, res, 'overtime_request');
}

export async function reviewCompensationController(req: AuthedRequest, res: Response): Promise<void> {
  await reviewFlowRequestController(req, res, 'time_bank_compensation');
}

export async function reviewOvertimeController(req: AuthedRequest, res: Response): Promise<void> {
  await reviewFlowRequestController(req, res, 'overtime_request');
}
