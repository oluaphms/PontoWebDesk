/**
 * Acesso centralizado à tabela `time_records` (Supabase).
 * Padrão: retornar dados; em erro de PostgREST, lançar `Error` com mensagem clara.
 */

import { getSupabaseClientOrThrow } from '../src/lib/supabaseClient';
import { throwIfTimesheetClosedForPunchMutation } from '../src/services/timesheetClosure';
import { db, type Filter } from './supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appendTimeAttendanceTimelineEvent } from '../src/services/timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from '../src/services/timeAttendanceTimeline.constants';
import { extractLocalCalendarDateFromIso } from '../src/utils/calendarUtils';
import { runRepGovernanceAfterManualMirrorAdjustment } from '../src/services/repOperationalIntegrity.service';
import { assertNoFutureOperationalPunch } from '../src/services/monitoring/monitoringGeoHardLock.service';

type DbSelectArg2 = Parameters<typeof db.select>[2];
type DbSelectArg3 = Parameters<typeof db.select>[3];

function throwIfError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidUuid(id: string, label: string): string {
  const trimmed = String(id ?? '').trim();
  if (!UUID_RE.test(trimmed)) {
    throw new Error(`${label} inválido (UUID esperado).`);
  }
  return trimmed;
}

function isInsertTimeRecordRpcUnavailable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const msg = String(error.message ?? '').toLowerCase();
  if (code === '42883' || code === 'PGRST202' || code === 'PGRST204') return true;
  if (msg.includes('could not find the function') || msg.includes('does not exist')) return true;
  if (msg.includes('operator does not exist') && msg.includes('uuid')) return true;
  return false;
}

function parseInsertTimeRecordRpcResult(
  rpcData: unknown,
): { id: string; timestamp?: string | number | null } | null {
  if (!rpcData || typeof rpcData !== 'object') return null;
  const row = rpcData as Record<string, unknown>;
  const rawId = row.record_id ?? row.id;
  if (rawId == null || String(rawId).trim() === '') return null;
  return {
    id: String(rawId),
    timestamp: row.timestamp as string | number | null | undefined,
  };
}

/** Mesmo pipeline que `db.select` (sessão + RLS + timeout interno). */
export async function listTimeRecords(
  filters: Filter[],
  orderOrOptions?: DbSelectArg2,
  limit?: DbSelectArg3,
): Promise<any[]> {
  return db.select('time_records', filters, orderOrOptions, limit);
}

export async function getTimeRecordsByUser(userId: string, limit = 50, offset = 0): Promise<any[]> {
  const { data, error } = await getSupabaseClientOrThrow()
    .from('time_records')
    .select('id, user_id, type, method, created_at, location, company_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  throwIfError(error, 'getTimeRecordsByUser');
  return data ?? [];
}

export async function getTimeRecordsByCompany(companyId: string, limit = 50, offset = 0): Promise<any[]> {
  const { data, error } = await getSupabaseClientOrThrow()
    .from('time_records')
    .select('id, user_id, type, created_at, company_id')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  throwIfError(error, 'getTimeRecordsByCompany');
  return data ?? [];
}

export async function getTimeRecordsByDateForUser(userId: string, date: string): Promise<any[]> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const { data, error } = await getSupabaseClientOrThrow()
    .from('time_records')
    .select('id, user_id, type, created_at, location, method')
    .eq('user_id', userId)
    .gte('created_at', startOfDay.toISOString())
    .lte('created_at', endOfDay.toISOString())
    .order('created_at', { ascending: true });
  throwIfError(error, 'getTimeRecordsByDateForUser');
  return data ?? [];
}

export async function countTimeRecordsByUser(userId: string): Promise<number> {
  const { count, error } = await getSupabaseClientOrThrow()
    .from('time_records')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  throwIfError(error, 'countTimeRecordsByUser');
  return count ?? 0;
}

/** Faixa `created_at` inclusive — usada por `getDayRecords` com margem de ±1 dia e filtro pelo instante do evento (timestamp primeiro). */
export async function getTimeRecordsForUserDayRange(
  userId: string,
  startInclusive: string,
  endInclusive: string,
): Promise<any[]> {
  return db.select(
    'time_records',
    [
      { column: 'user_id', operator: 'eq', value: userId },
      { column: 'created_at', operator: 'gte', value: startInclusive },
      { column: 'created_at', operator: 'lte', value: endInclusive },
    ],
    { column: 'created_at', ascending: true },
  );
}

/** Histórico recente para validação antifraude no registro de ponto. */
export async function getRecentTimeRecordsForUser(userId: string, limit = 50): Promise<any[]> {
  return db.select(
    'time_records',
    [{ column: 'user_id', operator: 'eq', value: userId }],
    {
      columns: 'id, type, timestamp, created_at, latitude, longitude, device_id',
      orderBy: { column: 'created_at', ascending: false },
      limit,
    },
  );
}

export async function getTimeRecordsForEmployeeDashboard(userId: string): Promise<any[]> {
  return db.select('time_records', [{ column: 'user_id', operator: 'eq', value: userId }], {
    columns: 'id, user_id, company_id, type, method, created_at, timestamp, source, origin',
    limit: 500,
  });
}

type TimeRecordLockRow = {
  company_id: string;
  user_id: string;
  timestamp: string | null;
  created_at: string;
};

async function selectTimeRecordLockRow(id: string): Promise<TimeRecordLockRow | null> {
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
      rpc_source: input.rpcSource ?? 'admin',
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
      rpc_source: input.rpcSource ?? 'admin',
    },
    supabaseClient: input.client,
  });
}

/**
 * Inclusão de batida pelo espelho admin: tenta RPC `insert_time_record_for_user`;
 * se não retornar `record_id`, faz insert direto (mesma lógica que `Timesheet.tsx`).
 */
export async function insertAdminMirrorTimeRecord(
  data: Record<string, unknown>,
  companyId: string,
  opts?: InsertAdminMirrorTimeRecordOpts,
): Promise<InsertAdminMirrorResult> {
  const userId = assertValidUuid(String(data.user_id ?? ''), 'user_id');
  const companyUuid = assertValidUuid(companyId, 'company_id');
  const type = String(data.type ?? '');
  const createdAt = String(data.created_at ?? '');
  if (!type || !createdAt) {
    throw new Error('insertAdminMirrorTimeRecord: type e created_at são obrigatórios.');
  }

  assertNoFutureOperationalPunch(createdAt);

  await throwIfTimesheetClosedForPunchMutation({
    companyId: companyUuid,
    employeeId: userId,
    refIso: createdAt,
    auditSource: 'services/timeRecords.service.insertAdminMirrorTimeRecord:precheck-rpc',
    auditAction: 'INSERT_PUNCH',
  });

  const sb = getSupabaseClientOrThrow();
  const { data: rpcData, error: rpcError } = await sb.rpc('insert_time_record_for_user', {
    p_user_id: userId,
    p_company_id: companyUuid,
    p_type: type,
    p_method: 'admin',
    p_source: opts?.rpcSource ?? 'admin',
    p_timestamp: createdAt,
    p_latitude: (data.latitude as number | null | undefined) ?? null,
    p_longitude: (data.longitude as number | null | undefined) ?? null,
    p_manual_reason: (data.manual_reason as string | null | undefined) ?? null,
  });

  const rpcParsed = !rpcError ? parseInsertTimeRecordRpcResult(rpcData) : null;
  if (rpcParsed) {
    let createdIso = createdAt;
    if (typeof rpcParsed.timestamp === 'string') {
      createdIso = rpcParsed.timestamp;
    } else if (
      rpcParsed.timestamp != null &&
      (typeof rpcParsed.timestamp === 'number' || typeof rpcParsed.timestamp === 'object')
    ) {
      createdIso = new Date(rpcParsed.timestamp as number | Date).toISOString();
    }
    logAdminMirrorOperationalTimeline({
      client: sb,
      companyId: companyUuid,
      userId,
      createdIso,
      type,
      recordId: rpcParsed.id,
      rpcSource: opts?.rpcSource,
    });
    if (opts?.repGovernance?.repPunchLogIds?.length) {
      const dateYmd = extractLocalCalendarDateFromIso(createdIso);
      void runRepGovernanceAfterManualMirrorAdjustment(sb, companyUuid, {
        repPunchLogIds: opts.repGovernance.repPunchLogIds,
        employeeId: userId,
        dateYmd,
        reviewedBy: opts.repGovernance.reviewedBy,
      });
    }
    return { id: rpcParsed.id, createdAt: createdIso };
  }

  if (rpcError && !isInsertTimeRecordRpcUnavailable(rpcError)) {
    throw new Error(`insert_time_record_for_user: ${rpcError.message}`);
  }

  if (rpcError && typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.warn('[timeRecords.service] insert_time_record_for_user (fallback insert):', rpcError);
  }

  const mergeId = crypto.randomUUID();
  await createTimeRecord({
    ...data,
    id: mergeId,
    user_id: userId,
    company_id: companyUuid,
    type,
    created_at: createdAt,
    timestamp: createdAt,
    source: opts?.rpcSource ?? 'admin',
    is_manual: true,
    method: 'admin',
  });
  logAdminMirrorOperationalTimeline({
    client: sb,
    companyId: companyUuid,
    userId,
    createdIso: createdAt,
    type,
    recordId: mergeId,
    rpcSource: opts?.rpcSource,
  });
  if (opts?.repGovernance?.repPunchLogIds?.length) {
    const dateYmd = extractLocalCalendarDateFromIso(createdAt);
    void runRepGovernanceAfterManualMirrorAdjustment(sb, companyUuid, {
      repPunchLogIds: opts.repGovernance.repPunchLogIds,
      employeeId: userId,
      dateYmd,
      reviewedBy: opts.repGovernance.reviewedBy,
    });
  }
  return { id: mergeId, createdAt };
}
