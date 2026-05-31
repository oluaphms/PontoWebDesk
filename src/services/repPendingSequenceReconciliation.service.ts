import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Reconciliação assistida: sequência REP inválida — ações explícitas do RH (sem auto-promote).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { recalculate_period } from '../engine/timeEngine';
import { insertAdminMirrorTimeRecord } from '../../services/timeRecords.service';
import {
  localCalendarDayEndUtc,
  localCalendarDayStartUtc,
  localDateAndTimeToIsoUtc,
} from '../utils/localDateTimeToIso';
import { getSupabaseClient } from './supabaseClient';
import { appendTimeAttendanceTimelineEvent } from './timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from './timeAttendanceTimeline.constants';
import {
  afterManualRepPromoteRpc,
  beforeManualRepPromoteRpc,
  runRepGovernanceAfterReconciliationAction,
} from './repOperationalIntegrity.service';
import { OperationalLifecycleStatus } from '../domain/operational/lifecycle/operationalLifecycleStatus';
import {
  assertRepLifecycleTransition,
  normalizeOperationalLifecycleStatus,
} from '../domain/operational/lifecycle/repOperationalStateMachine';
import {
  beginOperationalTransaction,
  commitOperationalTransaction,
  emitOperationalIncident,
  emitOperationalEvent,
  pushGovernanceUpdate,
  pushHealthUpdate,
} from '../domain/operational';

export const REP_PROMOTE_CLIENT_COOLDOWN_MS = 25_000;

type RepLogRow = {
  id: string;
  company_id: string;
  resolved_user_id: string | null;
  data_hora: string;
  time_record_id: string | null;
  ignored: boolean | null;
  nsr: number | null;
  promotion_error_code: string | null;
  last_promotion_attempt_at: string | null;
  operational_resolution_status: string | null;
  promotion_attempts: number | null;
};

async function fetchRepLogForAction(
  client: SupabaseClient,
  companyId: string,
  repPunchLogId: string,
): Promise<RepLogRow | null> {
  const { data, error } = await client
    .from('rep_punch_logs')
    .select(
      'id,company_id,resolved_user_id,data_hora,time_record_id,ignored,nsr,promotion_error_code,last_promotion_attempt_at,operational_resolution_status,promotion_attempts',
    )
    .eq('id', repPunchLogId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !data) return null;
  return data as RepLogRow;
}

async function recalcMirrorDay(companyId: string, employeeId: string, dateYmd: string): Promise<void> {
  try {
    await recalculate_period(employeeId, companyId, dateYmd, dateYmd);
  } catch (e) {
    observabilityConsole.warn('[REP RECONCILE RECALC]', e instanceof Error ? e.message : e);
  }
}

export async function markRepPunchInvestigating(params: {
  companyId: string;
  repPunchLogId: string;
  reviewedBy: string;
  supabaseClient?: SupabaseClient | null;
}): Promise<{ ok: boolean; error?: string }> {
  const client = params.supabaseClient ?? getSupabaseClient();
  if (!client) return { ok: false, error: 'Cliente indisponível.' };
  const row = await fetchRepLogForAction(client, params.companyId, params.repPunchLogId);
  if (!row) return { ok: false, error: 'Batida REP não encontrada.' };
  if (row.time_record_id) return { ok: false, error: 'Batida já vinculada a time_record.' };
  if (row.ignored) return { ok: false, error: 'Batida ignorada.' };
  const fromLifecycle = normalizeOperationalLifecycleStatus(row.operational_resolution_status);
  const toInvestigating = assertRepLifecycleTransition(fromLifecycle, OperationalLifecycleStatus.investigating);
  if (toInvestigating.ok === false) return { ok: false, error: toInvestigating.reason };
  const now = new Date().toISOString();
  const { error } = await client
    .from('rep_punch_logs')
    .update({
      operational_resolution_status: OperationalLifecycleStatus.investigating,
      operational_resolution_by: params.reviewedBy,
      operational_resolution_at: now,
    })
    .eq('id', params.repPunchLogId)
    .eq('company_id', params.companyId)
    .in('operational_resolution_status', [
      OperationalLifecycleStatus.pending,
      OperationalLifecycleStatus.investigating,
      OperationalLifecycleStatus.waiting_review,
    ]);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function reconcileRepPunchAsSaida(params: {
  companyId: string;
  employeeId: string;
  dateYmd: string;
  repPunchLogId: string;
  reviewedBy: string;
  note?: string | null;
  supabaseClient?: SupabaseClient | null;
}): Promise<{ ok: boolean; error?: string; timeRecordId?: string }> {
  const client = params.supabaseClient ?? getSupabaseClient();
  if (!client) return { ok: false, error: 'Cliente indisponível.' };
  const row = await fetchRepLogForAction(client, params.companyId, params.repPunchLogId);
  if (!row) return { ok: false, error: 'Batida REP não encontrada.' };
  if (row.time_record_id) return { ok: false, error: 'Batida já vinculada.' };
  if (row.ignored) return { ok: false, error: 'Batida ignorada.' };
  if (String(row.resolved_user_id ?? '').trim() !== params.employeeId.trim()) {
    return { ok: false, error: 'Colaborador não coincide com a batida REP.' };
  }
  if (row.promotion_error_code !== 'invalid_sequence') {
    return { ok: false, error: 'Ação disponível apenas para falha de sequência (invalid_sequence).' };
  }

  const fromLifecycle = normalizeOperationalLifecycleStatus(row.operational_resolution_status);
  const toReconciled = assertRepLifecycleTransition(fromLifecycle, OperationalLifecycleStatus.reconciled);
  if (toReconciled.ok === false) return { ok: false, error: toReconciled.reason };

  const before = {
    rep_punch_log_id: row.id,
    data_hora: row.data_hora,
    nsr: row.nsr,
    promotion_error_code: row.promotion_error_code,
  };

  const manualReason = [
    'Reconciliação assistida REP: marcação tratada como saída ao instante do relógio.',
    row.nsr != null ? `NSR ${row.nsr}.` : '',
    params.note?.trim() ? `Nota RH: ${params.note.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  let recordId: string;
  try {
    const ins = await insertAdminMirrorTimeRecord(
      {
        user_id: params.employeeId,
        type: 'saida',
        created_at: row.data_hora,
        manual_reason: manualReason,
      },
      params.companyId,
      { rpcSource: 'rep_reconciled' },
    );
    recordId = ins.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await appendTimeAttendanceTimelineEvent({
      companyId: params.companyId,
      employeeId: params.employeeId,
      date: params.dateYmd,
      eventType: TimeAttendanceTimelineEventType.INCIDENT_DETECTED,
      eventSeverity: TimeAttendanceTimelineSeverity.medium,
      sourceModule: 'repPendingSequenceReconciliation',
      sourceReferenceId: params.repPunchLogId,
      payload: {
        action: 'convert_to_saida_failed',
        before,
        error: msg,
      },
      createdBy: params.reviewedBy,
      supabaseClient: client,
    });
    return { ok: false, error: msg };
  }

  const now = new Date().toISOString();
  const { error: upErr } = await client
    .from('rep_punch_logs')
    .update({
      time_record_id: recordId,
      operational_resolution_status: OperationalLifecycleStatus.reconciled,
      operational_resolution_note: params.note?.trim() || null,
      operational_resolution_by: params.reviewedBy,
      operational_resolution_at: now,
    })
    .eq('id', params.repPunchLogId)
    .eq('company_id', params.companyId)
    .is('time_record_id', null);

  if (upErr) {
    return { ok: false, error: `Batida criada (${recordId}) mas falha ao vincular REP: ${upErr.message}` };
  }

  const txCtx = beginOperationalTransaction({
    actor: params.reviewedBy,
    company_id: params.companyId,
    source: 'repPendingSequenceReconciliation',
    supabaseClient: client,
    recovery_meta: {
      rep_reconciliation: {
        repPunchLogId: params.repPunchLogId,
        employeeId: params.employeeId,
        dateYmd: params.dateYmd,
        reviewedBy: params.reviewedBy,
        action: 'reconcile',
      },
    },
  });

  await emitOperationalEvent({
    supabaseClient: client,
    companyId: params.companyId,
    employeeId: params.employeeId,
    dateYmd: params.dateYmd,
    eventType: TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED,
    eventSeverity: TimeAttendanceTimelineSeverity.medium,
    correlationId: txCtx.correlation_id,
    actor: params.reviewedBy,
    source: 'repPendingSequenceReconciliation',
    sourceReferenceId: params.repPunchLogId,
    metadata: {
      action: 'convert_to_saida',
      before,
      after: { time_record_id: recordId, type: 'saida' },
    },
    createdBy: params.reviewedBy,
    transactionContext: txCtx,
    idempotencyKey: `rep_sequence_reconciled:${params.repPunchLogId}`,
  });

  emitOperationalIncident(txCtx, {
    companyId: params.companyId,
    employeeId: params.employeeId,
    dateYmd: params.dateYmd,
    incidentCode: `rep_sequence_reconciled:${params.repPunchLogId}`,
    resolvedBy: params.reviewedBy,
    resolutionNote: params.note?.trim() || null,
    incidentPayload: {
      category: 'REP_RECONCILIATION',
      human_reason: 'Reconciliação assistida: conversão explícita em saída.',
      recommended_action: 'Verificar espelho e demais batidas REP pendentes do dia.',
      lifecycle: OperationalLifecycleStatus.reconciled,
    },
  });

  pushHealthUpdate(txCtx, () => recalcMirrorDay(params.companyId, params.employeeId, params.dateYmd));
  pushGovernanceUpdate(txCtx, () =>
    runRepGovernanceAfterReconciliationAction(client, params.companyId, {
      repPunchLogId: params.repPunchLogId,
      employeeId: params.employeeId,
      dateYmd: params.dateYmd,
      reviewedBy: params.reviewedBy,
      action: 'reconcile',
    }),
  );

  const commitResult = await commitOperationalTransaction(client, txCtx);
  if (commitResult.ok === false) {
    return {
      ok: false,
      error: commitResult.rollback.message ?? 'Falha ao consolidar timeline, reviews e governança.',
      timeRecordId: recordId,
    };
  }
  return { ok: true, timeRecordId: recordId };
}

export async function insertManualSaidaForRepSequence(params: {
  companyId: string;
  employeeId: string;
  dateYmd: string;
  timeHHmm: string;
  reviewedBy: string;
  note?: string | null;
  supabaseClient?: SupabaseClient | null;
}): Promise<{ ok: boolean; error?: string; timeRecordId?: string }> {
  const client = params.supabaseClient ?? getSupabaseClient();
  if (!client) return { ok: false, error: 'Cliente indisponível.' };
  const createdAt = localDateAndTimeToIsoUtc(params.dateYmd, params.timeHHmm);
  const manualReason = [
    'Reconciliação assistida REP: saída manual inserida para destravar sequência.',
    params.note?.trim() ? `Nota RH: ${params.note.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  let recordId: string;
  try {
    const ins = await insertAdminMirrorTimeRecord(
      {
        user_id: params.employeeId,
        type: 'saida',
        created_at: createdAt,
        manual_reason: manualReason,
      },
      params.companyId,
      { rpcSource: 'rep_reconciled_manual' },
    );
    recordId = ins.id;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const txCtx = beginOperationalTransaction({
    actor: params.reviewedBy,
    company_id: params.companyId,
    source: 'repPendingSequenceReconciliation',
    supabaseClient: client,
    recovery_meta: {
      rep_reconciliation: {
        employeeId: params.employeeId,
        dateYmd: params.dateYmd,
        reviewedBy: params.reviewedBy,
        action: 'manual_saida',
      },
    },
  });

  await emitOperationalEvent({
    supabaseClient: client,
    companyId: params.companyId,
    employeeId: params.employeeId,
    dateYmd: params.dateYmd,
    eventType: TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED,
    eventSeverity: TimeAttendanceTimelineSeverity.medium,
    correlationId: txCtx.correlation_id,
    actor: params.reviewedBy,
    source: 'repPendingSequenceReconciliation',
    sourceReferenceId: recordId,
    metadata: {
      action: 'manual_saida',
      after: { time_record_id: recordId, type: 'saida', created_at: createdAt },
    },
    createdBy: params.reviewedBy,
    transactionContext: txCtx,
    idempotencyKey: `manual_saida:${recordId}`,
  });

  emitOperationalIncident(txCtx, {
    companyId: params.companyId,
    employeeId: params.employeeId,
    dateYmd: params.dateYmd,
    incidentCode: `rep_manual_saida:${params.dateYmd}:${recordId.slice(0, 8)}`,
    resolvedBy: params.reviewedBy,
    resolutionNote: params.note?.trim() || null,
    incidentPayload: {
      category: 'REP_RECONCILIATION',
      human_reason: 'Saída manual para reconciliação de sequência REP.',
    },
  });

  pushHealthUpdate(txCtx, () => recalcMirrorDay(params.companyId, params.employeeId, params.dateYmd));

  const commitResult = await commitOperationalTransaction(client, txCtx);
  if (commitResult.ok === false) {
    return {
      ok: false,
      error: commitResult.rollback.message ?? 'Falha ao consolidar timeline e reviews.',
      timeRecordId: recordId,
    };
  }
  return { ok: true, timeRecordId: recordId };
}

export async function ignoreRepPunchWithReason(params: {
  companyId: string;
  employeeId: string;
  dateYmd: string;
  repPunchLogId: string;
  reviewedBy: string;
  reason: string;
  supabaseClient?: SupabaseClient | null;
}): Promise<{ ok: boolean; error?: string }> {
  const reason = params.reason.trim();
  if (!reason) return { ok: false, error: 'Motivo obrigatório.' };

  const client = params.supabaseClient ?? getSupabaseClient();
  if (!client) return { ok: false, error: 'Cliente indisponível.' };
  const row = await fetchRepLogForAction(client, params.companyId, params.repPunchLogId);
  if (!row) return { ok: false, error: 'Batida REP não encontrada.' };
  if (row.time_record_id) return { ok: false, error: 'Batida já vinculada.' };
  if (String(row.resolved_user_id ?? '').trim() !== params.employeeId.trim()) {
    return { ok: false, error: 'Colaborador não coincide com a batida REP.' };
  }

  const before = {
    rep_punch_log_id: row.id,
    ignored: row.ignored,
    promotion_error_code: row.promotion_error_code,
  };

  const fromLifecycle = normalizeOperationalLifecycleStatus(row.operational_resolution_status);
  const toIgnored = assertRepLifecycleTransition(fromLifecycle, OperationalLifecycleStatus.ignored);
  if (toIgnored.ok === false) return { ok: false, error: toIgnored.reason };

  const now = new Date().toISOString();
  const { error } = await client
    .from('rep_punch_logs')
    .update({
      ignored: true,
      ignored_at: now,
      ignored_by: params.reviewedBy,
      operational_resolution_status: OperationalLifecycleStatus.ignored,
      operational_resolution_note: reason,
      operational_resolution_by: params.reviewedBy,
      operational_resolution_at: now,
    })
    .eq('id', params.repPunchLogId)
    .eq('company_id', params.companyId)
    .eq('ignored', false);

  if (error) return { ok: false, error: error.message };

  const txCtx = beginOperationalTransaction({
    actor: params.reviewedBy,
    company_id: params.companyId,
    source: 'repPendingSequenceReconciliation',
    supabaseClient: client,
    recovery_meta: {
      rep_reconciliation: {
        repPunchLogId: params.repPunchLogId,
        employeeId: params.employeeId,
        dateYmd: params.dateYmd,
        reviewedBy: params.reviewedBy,
        action: 'ignore',
      },
    },
  });

  await emitOperationalEvent({
    supabaseClient: client,
    companyId: params.companyId,
    employeeId: params.employeeId,
    dateYmd: params.dateYmd,
    eventType: TimeAttendanceTimelineEventType.REP_PUNCH_IGNORED,
    eventSeverity: TimeAttendanceTimelineSeverity.high,
    correlationId: txCtx.correlation_id,
    actor: params.reviewedBy,
    source: 'repPendingSequenceReconciliation',
    sourceReferenceId: params.repPunchLogId,
    metadata: { before, after: { ignored: true, reason }, reviewed_by: params.reviewedBy },
    createdBy: params.reviewedBy,
    transactionContext: txCtx,
    idempotencyKey: `rep_ignored:${params.repPunchLogId}`,
  });

  emitOperationalIncident(txCtx, {
    companyId: params.companyId,
    employeeId: params.employeeId,
    dateYmd: params.dateYmd,
    incidentCode: `rep_punch_ignored:${params.repPunchLogId}`,
    resolvedBy: params.reviewedBy,
    resolutionNote: reason,
    incidentPayload: {
      category: 'REP_RECONCILIATION',
      human_reason: 'Batida REP ignorada pelo RH (reconciliação assistida).',
      lifecycle: OperationalLifecycleStatus.ignored,
    },
  });

  pushHealthUpdate(txCtx, () => recalcMirrorDay(params.companyId, params.employeeId, params.dateYmd));
  pushGovernanceUpdate(txCtx, () =>
    runRepGovernanceAfterReconciliationAction(client, params.companyId, {
      repPunchLogId: params.repPunchLogId,
      employeeId: params.employeeId,
      dateYmd: params.dateYmd,
      reviewedBy: params.reviewedBy,
      action: 'ignore',
    }),
  );

  const commitResult = await commitOperationalTransaction(client, txCtx);
  if (commitResult.ok === false) {
    return { ok: false, error: commitResult.rollback.message ?? 'Falha ao consolidar timeline, reviews e governança.' };
  }
  return { ok: true };
}

export async function tryRepPromoteSingleLogAfterCooldown(params: {
  companyId: string;
  employeeId: string;
  dateYmd: string;
  repPunchLogId: string;
  reviewedBy: string;
  supabaseClient?: SupabaseClient | null;
}): Promise<{ ok: boolean; error?: string; result?: unknown }> {
  const client = params.supabaseClient ?? getSupabaseClient();
  if (!client) return { ok: false, error: 'Cliente indisponível.' };

  const row = await fetchRepLogForAction(client, params.companyId, params.repPunchLogId);
  if (!row) return { ok: false, error: 'Batida REP não encontrada.' };
  if (row.ignored) return { ok: false, error: 'Batida ignorada.' };

  const gate = await beforeManualRepPromoteRpc(client, params.companyId, params.repPunchLogId);
  if (gate.ok === false) return { ok: false, error: gate.error };

  const lastAt = row.last_promotion_attempt_at ? new Date(row.last_promotion_attempt_at).getTime() : 0;
  if (lastAt && Date.now() - lastAt < REP_PROMOTE_CLIENT_COOLDOWN_MS) {
    const waitSec = Math.ceil((REP_PROMOTE_CLIENT_COOLDOWN_MS - (Date.now() - lastAt)) / 1000);
    return { ok: false, error: `Aguarde ~${waitSec}s após a última tentativa de promote (cooldown).` };
  }

  const start = localCalendarDayStartUtc(params.dateYmd);
  const end = localCalendarDayEndUtc(params.dateYmd);

  const { data, error } = await client.rpc('rep_promote_pending_rep_punch_logs', {
    p_company_id: params.companyId,
    p_rep_device_id: null,
    p_local_window_start: start,
    p_local_window_end: end,
    p_only_user_id: params.employeeId,
    p_only_rep_punch_log_id: params.repPunchLogId,
  });

  if (error) return { ok: false, error: error.message };

  await appendTimeAttendanceTimelineEvent({
    companyId: params.companyId,
    employeeId: params.employeeId,
    date: params.dateYmd,
    eventType: TimeAttendanceTimelineEventType.REP_PROMOTE_RETRIED,
    eventSeverity: TimeAttendanceTimelineSeverity.info,
    sourceModule: 'repPendingSequenceReconciliation',
    sourceReferenceId: params.repPunchLogId,
    payload: { action: 'manual_repromote', result: data },
    createdBy: params.reviewedBy,
    supabaseClient: client,
  });

  await afterManualRepPromoteRpc(client, params.companyId, {
    repPunchLogId: params.repPunchLogId,
    employeeId: params.employeeId,
    dateYmd: params.dateYmd,
    reviewedBy: params.reviewedBy,
  });

  await recalcMirrorDay(params.companyId, params.employeeId, params.dateYmd);
  return { ok: true, result: data };
}
