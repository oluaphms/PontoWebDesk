/**
 * Acesso centralizado à tabela `time_records` (Supabase).
 * Padrão: retornar dados; em erro de PostgREST, lançar `Error` com mensagem clara.
 */

import { observabilityConsole } from '../src/shared/logger/observabilityConsole';
import { throwIfTimesheetClosedForPunchMutation } from '../src/services/timesheetClosure';
import { db, getSupabaseClientOrThrow, type Filter } from './supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appendTimeAttendanceTimelineEvent } from '../src/services/timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from '../src/services/timeAttendanceTimeline.constants';
import { extractLocalCalendarDateFromIso } from '../src/utils/calendarUtils';
import { runRepGovernanceAfterManualMirrorAdjustment } from '../src/services/repOperationalIntegrity.service';
import { assertNoFutureOperationalPunch } from '../src/services/monitoring/monitoringGeoHardLock.service';
import { assertValidUuid, insertTimeRecordForUser } from './insertTimeRecordRpc';
import { isCloudEnabled } from '../src/services/cloudService';
import { cloudFallback } from '../src/services/cloudFallback';
import { fetchTimeRecordsForMirrorWindow } from './api';
import { syncServerOperationalClockOffset } from '../src/services/serverOperationalClock.service';
import { operationalClockMs, OPERATIONAL_TIMEZONE } from '../src/utils/operationalClock';

type DbSelectArg2 = Parameters<typeof db.select>[2];
type DbSelectArg3 = Parameters<typeof db.select>[3];

function throwIfError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function uniqueStringIds(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function companyFilter(companyId?: string | null): Filter[] {
  const cid = String(companyId ?? '').trim();
  return cid ? [{ column: 'company_id', operator: 'eq', value: cid }] : [];
}

async function resolveLinkedTimeRecordUserIds(userId: string, companyId?: string | null): Promise<string[]> {
  const id = String(userId || '').trim();
  if (!id || !isCloudEnabled()) return id ? [id] : [];

  try {
    const scope = companyFilter(companyId);
    const [usersById, employeesById] = await Promise.all([
      db
        .select('users', [...scope, { column: 'id', operator: 'eq', value: id }], {
          columns: 'id,email',
          limit: 1,
        })
        .catch(() => []),
      db
        .select('employees', [...scope, { column: 'id', operator: 'eq', value: id }], {
          columns: 'id,email',
          limit: 1,
        })
        .catch(() => []),
    ]);
    const email = normalizeEmail(usersById?.[0]?.email ?? employeesById?.[0]?.email);
    if (!email) return [id];

    const [usersByEmail, employeesByEmail] = await Promise.all([
      db
        .select('users', [...scope, { column: 'email', operator: 'eq', value: email }], {
          columns: 'id,email',
          limit: 5,
        })
        .catch(() => []),
      db
        .select('employees', [...scope, { column: 'email', operator: 'eq', value: email }], {
          columns: 'id,email',
          limit: 5,
        })
        .catch(() => []),
    ]);

    return uniqueStringIds([
      id,
      ...(usersByEmail ?? []).map((row) => row.id),
      ...(employeesByEmail ?? []).map((row) => row.id),
    ]);
  } catch {
    return [id];
  }
}

function dedupeRowsById(rows: any[]): any[] {
  const byId = new Map<string, any>();
  const out: any[] = [];
  for (const row of rows ?? []) {
    const id = String(row?.id ?? '').trim();
    if (id) {
      byId.set(id, row);
      continue;
    }
    out.push(row);
  }
  return [...byId.values(), ...out];
}

/** Mesmo pipeline que `db.select` (sessão + RLS + timeout interno). */
export async function listTimeRecords(
  filters: Filter[],
  orderOrOptions?: DbSelectArg2,
  limit?: DbSelectArg3,
): Promise<any[]> {
  if (!isCloudEnabled()) return cloudFallback([]);
  return db.select('time_records', filters, orderOrOptions, limit);
}

export async function getTimeRecordsByUser(userId: string, limit = 50, offset = 0): Promise<any[]> {
  if (!isCloudEnabled()) return cloudFallback([]);
  return db.select(
    'time_records',
    [{ column: 'user_id', operator: 'eq', value: userId }],
    {
      columns: 'id, user_id, type, method, created_at, timestamp, location, company_id, source, origin',
      orderBy: { column: 'created_at', ascending: false },
      limit,
      offset,
    },
  );
}

export async function getTimeRecordsByCompany(companyId: string, limit = 50, offset = 0): Promise<any[]> {
  if (!isCloudEnabled()) return cloudFallback([]);
  return db.select(
    'time_records',
    [{ column: 'company_id', operator: 'eq', value: companyId }],
    {
      columns: 'id, user_id, type, created_at, timestamp, company_id, source, origin',
      orderBy: { column: 'created_at', ascending: false },
      limit,
      offset,
    },
  );
}

export async function getTimeRecordsByDateForUser(userId: string, date: string): Promise<any[]> {
  if (!isCloudEnabled()) return cloudFallback([]);
  const dayYmd = date.slice(0, 10);
  return fetchTimeRecordsForMirrorWindow(
    [{ column: 'user_id', operator: 'eq', value: userId }],
    dayYmd,
    dayYmd,
    true,
    500,
  );
}

export async function countTimeRecordsByUser(userId: string): Promise<number> {
  if (!isCloudEnabled()) return cloudFallback(0);
  const { count, error } = await getSupabaseClientOrThrow()
    .from('time_records')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  throwIfError(error, 'countTimeRecordsByUser');
  return count ?? 0;
}

/** Faixa de dia civil inclusiva — usa `timestamp` primeiro e `created_at` como fallback de espelho. */
export async function getTimeRecordsForUserDayRange(
  userId: string,
  startInclusive: string,
  endInclusive: string,
  companyId?: string | null,
): Promise<any[]> {
  if (!isCloudEnabled()) return cloudFallback([]);
  const recordUserIds = await resolveLinkedTimeRecordUserIds(userId, companyId);
  const periodStartYmd = startInclusive.slice(0, 10);
  const periodEndYmd = endInclusive.slice(0, 10);
  const rows = await Promise.all(
    recordUserIds.map((recordUserId) =>
      fetchTimeRecordsForMirrorWindow(
        [...companyFilter(companyId), { column: 'user_id', operator: 'eq', value: recordUserId }],
        periodStartYmd,
        periodEndYmd,
        true,
        2000,
      ),
    ),
  );
  return dedupeRowsById(rows.flat()).sort(
    (a, b) => new Date(String(a.timestamp ?? a.created_at ?? 0)).getTime() - new Date(String(b.timestamp ?? b.created_at ?? 0)).getTime(),
  );
}

/** Histórico recente para validação antifraude no registro de ponto. */
export async function getRecentTimeRecordsForUser(userId: string, limit = 50, companyId?: string | null): Promise<any[]> {
  if (!isCloudEnabled()) return cloudFallback([]);
  const recordUserIds = await resolveLinkedTimeRecordUserIds(userId, companyId);
  const rows = await Promise.all(
    recordUserIds.map((recordUserId) =>
      db.select(
        'time_records',
        [...companyFilter(companyId), { column: 'user_id', operator: 'eq', value: recordUserId }],
        {
          columns: 'id, type, timestamp, created_at, latitude, longitude, device_id',
          orderBy: { column: 'created_at', ascending: false },
          limit,
        },
      ),
    ),
  );
  return dedupeRowsById(rows.flat())
    .sort((a, b) => new Date(String(b.timestamp ?? b.created_at ?? 0)).getTime() - new Date(String(a.timestamp ?? a.created_at ?? 0)).getTime())
    .slice(0, limit);
}

export async function getTimeRecordsForEmployeeDashboard(
  userId: string,
  companyId?: string | null,
  periodStartYmd?: string,
  periodEndYmd?: string,
): Promise<any[]> {
  if (!isCloudEnabled()) return cloudFallback([]);
  const recordUserIds = await resolveLinkedTimeRecordUserIds(userId, companyId);
  const baseFilters: Filter[] = companyFilter(companyId);
  if (periodStartYmd && periodEndYmd) {
    const rows = await Promise.all(
      recordUserIds.map((recordUserId) =>
        fetchTimeRecordsForMirrorWindow(
          [...baseFilters, { column: 'user_id', operator: 'eq', value: recordUserId }],
          periodStartYmd,
          periodEndYmd,
          false,
          2000,
        ),
      ),
    );
    return dedupeRowsById(rows.flat()).sort(
      (a, b) => new Date(String(b.timestamp ?? b.created_at ?? 0)).getTime() - new Date(String(a.timestamp ?? a.created_at ?? 0)).getTime(),
    );
  }
  const rows = await Promise.all(
    recordUserIds.map((recordUserId) =>
      db.select('time_records', [...baseFilters, { column: 'user_id', operator: 'eq', value: recordUserId }], {
        columns: 'id, user_id, company_id, type, method, created_at, timestamp, source, origin',
        orderBy: { column: 'created_at', ascending: false },
        limit: 500,
      }),
    ),
  );
  return dedupeRowsById(rows.flat()).sort(
    (a, b) => new Date(String(b.timestamp ?? b.created_at ?? 0)).getTime() - new Date(String(a.timestamp ?? a.created_at ?? 0)).getTime(),
  );
}

type TimeRecordLockRow = {
  company_id: string;
  user_id: string;
  timestamp: string | null;
  created_at: string;
};

async function selectTimeRecordLockRow(id: string): Promise<TimeRecordLockRow | null> {
  try {
    const row = await db.findById<TimeRecordLockRow>(
      'time_records',
      id,
      'company_id, user_id, timestamp, created_at',
    );
    if (row) return row;
  } catch {
    /* fallback abaixo */
  }
  const { data, error } = await getSupabaseClientOrThrow()
    .from('time_records')
    .select('company_id, user_id, timestamp, created_at')
    .eq('id', id)
    .maybeSingle();
  throwIfError(error, 'selectTimeRecordLockRow');
  return data ? (data as TimeRecordLockRow) : null;
}

function refInstantFromLockRow(row: TimeRecordLockRow): string | null {
  const t = row.timestamp != null && String(row.timestamp).trim() ? String(row.timestamp).trim() : '';
  const c = row.created_at != null && String(row.created_at).trim() ? String(row.created_at).trim() : '';
  return t || c || null;
}

export async function createTimeRecord(row: Record<string, unknown>): Promise<void> {
  if (!isCloudEnabled()) return;
  const companyId = String(row.company_id ?? '').trim();
  const employeeId = String(row.user_id ?? '').trim();
  const refIso =
    (typeof row.timestamp === 'string' && row.timestamp.trim() ? row.timestamp : null) ||
    (typeof row.created_at === 'string' && row.created_at.trim() ? row.created_at : null);

  if (refIso) {
    assertNoFutureOperationalPunch(refIso);
  }

  if (companyId && employeeId) {
    await throwIfTimesheetClosedForPunchMutation({
      companyId,
      employeeId,
      refIso,
      auditSource: 'services/timeRecords.service.createTimeRecord',
      auditAction: 'INSERT_PUNCH',
    });
  }

  const { error } = await getSupabaseClientOrThrow().from('time_records').insert(row);
  throwIfError(error, 'createTimeRecord');
}

/** Consolidação REP → espelho: localiza batida já gravada pelo NSR (mesmo critério que `RepDevices.tsx`). */
export async function findTimeRecordIdByCompanySourceNsr(
  companyId: string,
  nsr: number,
): Promise<string | null> {
  if (!isCloudEnabled()) return cloudFallback(null);
  const { data, error } = await getSupabaseClientOrThrow()
    .from('time_records')
    .select('id')
    .eq('company_id', companyId)
    .eq('source', 'rep')
    .eq('nsr', nsr)
    .limit(1)
    .maybeSingle();
  throwIfError(error, 'findTimeRecordIdByCompanySourceNsr');
  return data && typeof (data as { id?: string }).id === 'string' ? (data as { id: string }).id : null;
}

export async function updateTimeRecord(id: string, patch: Record<string, unknown>): Promise<void> {
  if (!isCloudEnabled()) return;
  const row = await selectTimeRecordLockRow(id);
  if (!row) throw new Error('Registro de ponto não encontrado.');

  const oldRef = refInstantFromLockRow(row);
  await throwIfTimesheetClosedForPunchMutation({
    companyId: row.company_id,
    employeeId: row.user_id,
    refIso: oldRef,
    auditSource: 'services/timeRecords.service.updateTimeRecord',
    auditAction: 'UPDATE_PUNCH',
  });

  const patchTs =
    patch.timestamp !== undefined && patch.timestamp != null ? String(patch.timestamp).trim() : undefined;
  const patchCreated =
    patch.created_at !== undefined && patch.created_at != null ? String(patch.created_at).trim() : undefined;
  const newRef =
    patchTs ??
    patchCreated ??
    oldRef ??
    undefined;
  if (newRef !== oldRef) {
    await throwIfTimesheetClosedForPunchMutation({
      companyId: row.company_id,
      employeeId: row.user_id,
      refIso: newRef || null,
      auditSource: 'services/timeRecords.service.updateTimeRecord:novo-instante',
      auditAction: 'UPDATE_PUNCH',
    });
  }

  const { error } = await getSupabaseClientOrThrow().from('time_records').update(patch).eq('id', id);
  throwIfError(error, 'updateTimeRecord');
}

export async function deleteTimeRecord(id: string): Promise<void> {
  if (!isCloudEnabled()) return;
  const row = await selectTimeRecordLockRow(id);
  if (!row) throw new Error('Registro de ponto não encontrado.');

  await throwIfTimesheetClosedForPunchMutation({
    companyId: row.company_id,
    employeeId: row.user_id,
    refIso: refInstantFromLockRow(row),
    auditSource: 'services/timeRecords.service.deleteTimeRecord',
    auditAction: 'DELETE_PUNCH',
  });

  const { error } = await getSupabaseClientOrThrow().from('time_records').delete().eq('id', id);
  throwIfError(error, 'deleteTimeRecord');
}

/** Ajuste de horário aprovado (espelho): atualiza instante oficial da batida. */
export async function updateTimeRecordPunchInstant(
  id: string,
  newCreatedAtIso: string,
  updatedAtIso: string,
): Promise<void> {
  if (!isCloudEnabled()) return;
  const row = await selectTimeRecordLockRow(id);
  if (!row) throw new Error('Registro de ponto não encontrado.');
  await throwIfTimesheetClosedForPunchMutation({
    companyId: row.company_id,
    employeeId: row.user_id,
    refIso: refInstantFromLockRow(row),
    auditSource: 'services/timeRecords.service.updateTimeRecordPunchInstant:antes',
    auditAction: 'UPDATE_PUNCH',
  });
  await throwIfTimesheetClosedForPunchMutation({
    companyId: row.company_id,
    employeeId: row.user_id,
    refIso: newCreatedAtIso,
    auditSource: 'services/timeRecords.service.updateTimeRecordPunchInstant:depois',
    auditAction: 'UPDATE_PUNCH',
  });

  const { error } = await getSupabaseClientOrThrow()
    .from('time_records')
    .update({ created_at: newCreatedAtIso, updated_at: updatedAtIso })
    .eq('id', id);
  throwIfError(error, 'updateTimeRecordPunchInstant');
}

export type InsertAdminMirrorResult = { id: string; createdAt: string };

export type RepGovernanceAfterManualAdjustmentOpts = {
  repPunchLogIds: string[];
  reviewedBy?: string | null;
};

export type InsertAdminMirrorTimeRecordOpts = {
  rpcSource?: string;
  allowOutOfOrder?: boolean;
  /** Se a batida manual foi motivada por batidas REP pendentes, roda governança pós-ajuste. */
  repGovernance?: RepGovernanceAfterManualAdjustmentOpts;
};

function logAdminMirrorOperationalTimeline(input: {
  client: SupabaseClient;
  companyId: string;
  userId: string;
  createdIso: string;
  type: string;
  recordId: string;
  rpcSource?: string;
}): void {
  const dateYmd = input.createdIso.slice(0, 10);
  void appendTimeAttendanceTimelineEvent({
    companyId: input.companyId,
    employeeId: input.userId,
    date: dateYmd,
    eventType: TimeAttendanceTimelineEventType.TIME_RECORD_CREATED,
    eventSeverity: TimeAttendanceTimelineSeverity.info,
    sourceModule: 'timeRecords.insertAdminMirrorTimeRecord',
    sourceReferenceId: input.recordId,
    payload: {
      type: input.type,
      rpc_source: input.rpcSource ?? 'manual',
    },
    supabaseClient: input.client,
  });
  void appendTimeAttendanceTimelineEvent({
    companyId: input.companyId,
    employeeId: input.userId,
    date: dateYmd,
    eventType: TimeAttendanceTimelineEventType.MANUAL_ADJUSTMENT,
    eventSeverity: TimeAttendanceTimelineSeverity.low,
    sourceModule: 'timeRecords.insertAdminMirrorTimeRecord',
    sourceReferenceId: input.recordId,
    payload: {
      action: 'mirror_manual_punch',
      type: input.type,
      rpc_source: input.rpcSource ?? 'manual',
    },
    supabaseClient: input.client,
  });
}

/** Inclusão de batida pelo espelho admin via RPC `insert_time_record_for_user`. */
export async function insertAdminMirrorTimeRecord(
  data: Record<string, unknown>,
  companyId: string,
  opts?: InsertAdminMirrorTimeRecordOpts,
): Promise<InsertAdminMirrorResult> {
  if (!isCloudEnabled()) {
    return cloudFallback({
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `local-${Date.now()}`,
      createdAt: String(data.created_at ?? new Date().toISOString()),
    });
  }
  const userId = assertValidUuid(String(data.user_id ?? ''), 'user_id');
  const companyUuid = assertValidUuid(companyId, 'company_id');
  const type = String(data.type ?? '');
  const createdAt = String(data.created_at ?? '');
  if (!type || !createdAt) {
    throw new Error('insertAdminMirrorTimeRecord: type e created_at são obrigatórios.');
  }

  await syncServerOperationalClockOffset();
  const serverAlignedNowMs = operationalClockMs();
  const requestMs = new Date(createdAt).getTime();
  observabilityConsole.info('[MANUAL PUNCH TIME DIAG]', {
    CLIENT_TIME: new Date().toISOString(),
    PAYLOAD_TIME: createdAt,
    serverAlignedNow: new Date(serverAlignedNowMs).toISOString(),
    timezone: OPERATIONAL_TIMEZONE,
    differenceSeconds: Number.isFinite(requestMs) ? Math.round((requestMs - serverAlignedNowMs) / 1000) : null,
    source: 'insertAdminMirrorTimeRecord',
  });

  assertNoFutureOperationalPunch(createdAt);

  await throwIfTimesheetClosedForPunchMutation({
    companyId: companyUuid,
    employeeId: userId,
    refIso: createdAt,
    auditSource: 'services/timeRecords.service.insertAdminMirrorTimeRecord:precheck-rpc',
    auditAction: 'INSERT_PUNCH',
  });

  const sb = getSupabaseClientOrThrow() as unknown as SupabaseClient;
  const mirrorDateYmd = String(data.mirror_date_ymd ?? extractLocalCalendarDateFromIso(createdAt)).slice(0, 10);
  const inserted = await insertTimeRecordForUser(sb, {
    userId,
    companyId: companyUuid,
    type,
    timestampIso: createdAt,
    method: 'admin',
    // Para regra de monotonicidade SQL: retroativo só é permitido com source=manual.
    source: 'manual',
    // Hard lock produção: ajuste manual deve aceitar retroativo por padrão.
    allowOutOfOrder: opts?.allowOutOfOrder ?? true,
    manualReason: (data.manual_reason as string | null | undefined) ?? null,
    mirrorDateYmd: /^\d{4}-\d{2}-\d{2}$/.test(mirrorDateYmd) ? mirrorDateYmd : null,
    latitude: (data.latitude as number | null | undefined) ?? null,
    longitude: (data.longitude as number | null | undefined) ?? null,
  });

  logAdminMirrorOperationalTimeline({
    client: sb,
    companyId: companyUuid,
    userId,
    createdIso: inserted.timestamp,
    type,
    recordId: inserted.id,
    rpcSource: opts?.rpcSource,
  });
  if (opts?.repGovernance?.repPunchLogIds?.length) {
    const dateYmd = extractLocalCalendarDateFromIso(inserted.timestamp);
    void runRepGovernanceAfterManualMirrorAdjustment(sb, companyUuid, {
      repPunchLogIds: opts.repGovernance.repPunchLogIds,
      employeeId: userId,
      dateYmd,
      reviewedBy: opts.repGovernance.reviewedBy,
    });
  }
  return { id: inserted.id, createdAt: inserted.timestamp };
}
