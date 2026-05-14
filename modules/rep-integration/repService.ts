/**
 * Serviço de integração REP - ingestão de marcações, logs e consolidação em time_records
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedAfdRecord, RepDevice, PunchFromDevice } from './types';
import { afdRecordToIsoDateTime, matriculaFromAfdPisField } from './repParser';
import type { RepWeakPisMatchUser } from './repWeakPisFallbackMatch';
import {
  runRepIngestPunchRpc,
  fetchWeakMatchUsersForCompany,
  recordRepPromoteMirrorFailureOnTimeline,
  repCivilDateFromIsoUtc,
} from './repIngestPunchCore';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from '../../src/services/timeAttendanceTimeline.constants';
import { syncEspelhoAfterRepPromote, type RepPromotedDetailRow } from './repTimesheetMirror';
import {
  reconcileOperationalDaySequence,
  saoPauloCivilBoundsUtc,
} from './repOperationalSequenceResolver';

type AppendTimelineInput = import('../../src/services/timeAttendanceTimeline.service').AppendTimeAttendanceTimelineEventInput;

function enqueueAppendTimeAttendanceTimelineEvent(input: AppendTimelineInput): void {
  void import('../../src/services/timeAttendanceTimeline.service').then((m) =>
    m.appendTimeAttendanceTimelineEvent(input).catch((err) => {
      console.error('[repService] appendTimeAttendanceTimelineEvent', err);
    }),
  );
}

export interface IngestResult {
  success: boolean;
  imported: number;
  duplicated: number;
  userNotFound: number;
  errors: string[];
  /** Marcações só em rep_punch_logs (modo fila temporária) */
  staged?: number;
  /** Batida gravada no REP mas o espelho rejeitou (ex.: sequência inválida); evidência em rep_punch_logs. */
  promoteMirrorFailed?: number;
}

/**
 * Ingere uma marcação vinda do REP (RPC rep_ingest_punch)
 */
export async function ingestPunch(
  supabase: SupabaseClient,
  params: {
    company_id: string;
    rep_device_id?: string | null;
    pis?: string | null;
    cpf?: string | null;
    matricula?: string | null;
    nome_funcionario?: string | null;
    data_hora: string;
    tipo_marcacao: string;
    nsr?: number | null;
    raw_data?: Record<string, unknown>;
    /** Só grava rep_punch_logs; não cria time_records até consolidar */
    only_staging?: boolean;
    /** Na entrada, marca is_late conforme escala + tolerância */
    apply_schedule?: boolean;
    /** Se definido, todas as batidas desta chamada gravam neste utilizador (importação AFD / reatribuição). */
    force_user_id?: string | null;
    /** Lista de colaboradores (mesma empresa) para match fraco controlado quando não há PIS com DV válido. */
    weak_match_users?: readonly RepWeakPisMatchUser[] | null;
    /** Quando true, não grava timeline por batida (lotes); preferir resumo no chamador. */
    omitTimeline?: boolean;
  },
): Promise<{
  success: boolean;
  time_record_id?: string;
  user_not_found?: boolean;
  /** NSR já existia em rep_punch_logs para este relógio. */
  duplicate?: boolean;
  error?: string;
  /** Falha de INSERT em time_records com log preservado (RPC devolve código estável). */
  promoteMirrorFailed?: boolean;
  promotion_error_code?: string;
  rep_log_id?: string;
  promotion_attempts?: number;
}> {
  return runRepIngestPunchRpc(supabase, params, { recordTimeline: !params.omitTimeline });
}
/**
 * Ingere lote de registros AFD parseados
 */
export async function ingestAfdRecords(
  supabase: SupabaseClient,
  companyId: string,
  repDeviceId: string | null,
  records: ParsedAfdRecord[],
  timezone?: string,
  /** Atribui todas as linhas do ficheiro a este colaborador (ignora PIS/CPF do AFD). */
  forceUserId?: string | null
): Promise<IngestResult> {
  const result: IngestResult = {
    success: true,
    imported: 0,
    duplicated: 0,
    userNotFound: 0,
    errors: [],
    promoteMirrorFailed: 0,
  };

  let weakUsers: RepWeakPisMatchUser[] | null = null;
  if (!forceUserId) {
    weakUsers = await fetchWeakMatchUsersForCompany(supabase, companyId);
  }

  for (const rec of records) {
    const dataHora = `${rec.data}T${rec.hora}:00.000Z`;
    const iso = timezone ? afdRecordToIsoDateTime(rec, timezone) : dataHora;

    const r = await ingestPunch(supabase, {
      company_id: companyId,
      rep_device_id: repDeviceId,
      pis: rec.cpfOuPis,
      cpf: rec.cpfOuPis,
      matricula: matriculaFromAfdPisField(rec.cpfOuPis) ?? null,
      nome_funcionario: null,
      data_hora: iso,
      tipo_marcacao: rec.tipo,
      nsr: rec.nsr,
      raw_data: { raw: rec.raw },
      force_user_id: forceUserId ?? null,
      weak_match_users: forceUserId ? null : weakUsers,
      omitTimeline: true,
    });

    if (r.duplicate || (r.error && r.error.includes('já importado'))) {
      result.duplicated += 1;
    } else if (r.success && r.user_not_found) {
      result.userNotFound += 1;
    } else if (r.success) {
      result.imported += 1;
    } else {
      result.errors.push(r.error || 'Erro desconhecido');
    }
  }

  enqueueAppendTimeAttendanceTimelineEvent({
    companyId: companyId.trim(),
    eventType: TimeAttendanceTimelineEventType.REP_PUNCH_RECEIVED,
    eventSeverity: TimeAttendanceTimelineSeverity.info,
    sourceModule: 'repService.ingestAfdRecords',
    payload: {
      batch_summary: true,
      imported: result.imported,
      duplicated: result.duplicated,
      userNotFound: result.userNotFound,
      promote_mirror_failed: result.promoteMirrorFailed ?? 0,
      errors_count: result.errors.length,
    },
    supabaseClient: supabase,
  });

  return result;
}

/**
 * Ingere lote de marcações vindas do dispositivo (fetch)
 */
export type RepIngestBatchProgress = {
  /** Índice do lote concluído (1..totalBatches). */
  batchIndex: number;
  totalBatches: number;
  /** Quantas batidas já processadas neste lote acumulado. */
  processedCount: number;
  /** Total de batidas a gravar. */
  total: number;
  /** Paralelismo usado (RPCs em paralelo por lote). */
  concurrency: number;
};

export type IngestPunchesFromDeviceOptions = {
  onlyStaging?: boolean;
  applySchedule?: boolean;
  /**
   * Usado em `syncRepDevice` após baixar as batidas: restringe à data local de hoje.
   * `incremental` = sem filtro extra (comportamento padrão).
   */
  receiveScope?: 'incremental' | 'today_only';
  /**
   * Chamado ao concluir cada lote de ingestão (amostrado em importações muito grandes
   * para não gerar milhares de linhas — no máximo ~50 eventos).
   */
  onBatchProgress?: (p: RepIngestBatchProgress) => void;
  /** Se true, não carrega colaboradores para match fraco (PIS truncado / DV inválido). */
  skipWeakPisMatch?: boolean;
};

function foldIngestPunchRow(
  r: Awaited<ReturnType<typeof ingestPunch>>,
  onlyStaging: boolean,
  result: IngestResult
): void {
  if (r.duplicate || (r.error && r.error.includes('já importado'))) {
    result.duplicated += 1;
    return;
  }
  if (r.promoteMirrorFailed) {
    result.promoteMirrorFailed = (result.promoteMirrorFailed ?? 0) + 1;
    return;
  }
  if (r.success && r.user_not_found) {
    /** Com fila temporária, «sem usuário» é esperado: conta só em staged, não duplicar em userNotFound. */
    if (onlyStaging) {
      result.staged = (result.staged ?? 0) + 1;
    } else {
      result.userNotFound += 1;
    }
  } else if (r.success) {
    if (onlyStaging) {
      result.staged = (result.staged ?? 0) + 1;
    } else {
      result.imported += 1;
    }
  } else if (result.errors.length < 100) {
    result.errors.push(r.error || 'Erro desconhecido');
  }
}

/**
 * RPCs em paralelo (lotes) + yield ao event loop: evita UI «congelada» por milhares de batidas sequenciais.
 */
export function getRepIngestConcurrency(): number {
  const raw =
    typeof process !== 'undefined' && process.env?.REP_INGEST_CONCURRENCY
      ? String(process.env.REP_INGEST_CONCURRENCY).trim()
      : '';
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1) return Math.min(16, n);
  return 4;
}

export async function ingestPunchesFromDevice(
  supabase: SupabaseClient,
  device: RepDevice,
  punches: PunchFromDevice[],
  options?: IngestPunchesFromDeviceOptions
): Promise<IngestResult> {
  const result: IngestResult = {
    success: true,
    imported: 0,
    duplicated: 0,
    userNotFound: 0,
    errors: [],
    staged: 0,
    promoteMirrorFailed: 0,
  };
  const onlyStaging = options?.onlyStaging ?? false;
  const applySchedule = options?.applySchedule ?? false;
  const concurrency = getRepIngestConcurrency();
  const onBatchProgress = options?.onBatchProgress;
  let weakUsers: RepWeakPisMatchUser[] | null = null;
  if (!options?.skipWeakPisMatch) {
    weakUsers = await fetchWeakMatchUsersForCompany(supabase, device.company_id);
  }
  const sorted = [...punches].sort((a, b) => {
    const ta = Date.parse(a.data_hora);
    const tb = Date.parse(b.data_hora);
    if (ta !== tb) return ta - tb;
    return (a.nsr ?? 0) - (b.nsr ?? 0);
  });
  const groups = new Map<string, PunchFromDevice[]>();
  for (const p of sorted) {
    const k = repPunchIngestGroupKey(p);
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const orderedKeys = Array.from(groups.keys()).sort((ka, kb) => {
    const a = groups.get(ka)![0];
    const b = groups.get(kb)![0];
    return Date.parse(a.data_hora) - Date.parse(b.data_hora);
  });
  const total = sorted.length;
  const totalBatches = total > 0 ? Math.ceil(orderedKeys.length / concurrency) : 0;
  /** Máximo de callbacks de progresso (importações enormes). */
  const maxProgressSamples = 50;
  const progressStep =
    totalBatches <= maxProgressSamples ? 1 : Math.max(1, Math.ceil(totalBatches / maxProgressSamples));

  let processedCount = 0;
  for (let i = 0; i < orderedKeys.length; i += concurrency) {
    const sliceKeys = orderedKeys.slice(i, i + concurrency);
    const batch = await Promise.all(
      sliceKeys.map(async (key) => {
        const list = groups.get(key)!;
        const out: Awaited<ReturnType<typeof ingestPunch>>[] = [];
        for (const p of list) {
          out.push(
            await ingestPunch(supabase, {
              company_id: device.company_id,
              rep_device_id: device.id,
              pis: p.pis ?? null,
              cpf: p.cpf ?? null,
              matricula: p.matricula ?? null,
              nome_funcionario: p.nome ?? null,
              data_hora: p.data_hora,
              tipo_marcacao: p.tipo || 'E',
              nsr: p.nsr ?? null,
              raw_data: p.raw ?? {},
              only_staging: onlyStaging,
              apply_schedule: applySchedule,
              weak_match_users: weakUsers,
              omitTimeline: true,
            }),
          );
        }
        return out;
      }),
    );
    const flat = batch.flat();
    for (const r of flat) {
      foldIngestPunchRow(r, onlyStaging, result);
    }
    processedCount += flat.length;
    if (onBatchProgress && totalBatches > 0) {
      const batchIndex = Math.floor(i / concurrency) + 1;
      const isFirst = batchIndex === 1;
      const isLast = batchIndex === totalBatches;
      const onStep = totalBatches <= maxProgressSamples || batchIndex % progressStep === 0;
      if (isFirst || isLast || onStep) {
        onBatchProgress({
          batchIndex,
          totalBatches,
          processedCount,
          total,
          concurrency,
        });
      }
    }
    if (i + concurrency < orderedKeys.length) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }

  enqueueAppendTimeAttendanceTimelineEvent({
    companyId: device.company_id.trim(),
    eventType: TimeAttendanceTimelineEventType.REP_PUNCH_RECEIVED,
    eventSeverity: TimeAttendanceTimelineSeverity.info,
    sourceModule: 'repService.ingestPunchesFromDevice',
    payload: {
      batch_summary: true,
      rep_device_id: device.id,
      imported: result.imported,
      duplicated: result.duplicated,
      userNotFound: result.userNotFound,
      staged: result.staged ?? 0,
      promote_mirror_failed: result.promoteMirrorFailed ?? 0,
      errors_count: result.errors.length,
    },
    supabaseClient: supabase,
  });

  return result;
}

export type RepPromoteFailedDetailRow = {
  rep_punch_log_id?: string;
  nsr?: number | null;
  user_id?: string;
  data_hora?: string;
  error_code?: string;
  message?: string;
  promotion_attempts?: number | null;
};

export type RepPromoteRecoveredDetailRow = {
  rep_punch_log_id?: string;
  nsr?: number | null;
  user_id?: string;
  data_hora?: string;
  previous_error_code?: string;
};

async function logRepOperationalReconciliationForPromoteBatch(
  supabase: SupabaseClient,
  companyId: string,
  batch: { promoted: RepPromotedDetailRow[]; failed: RepPromoteFailedDetailRow[] },
): Promise<void> {
  const keys = new Set<string>();
  const add = (uid: string | undefined | null, iso: string | null | undefined) => {
    const u = String(uid ?? '').trim();
    if (!u) return;
    const ymd = iso ? repCivilDateFromIsoUtc(iso) : null;
    if (!ymd) return;
    keys.add(`${u}|${ymd}`);
  };
  for (const p of batch.promoted) add(p.user_id, p.data_hora != null ? String(p.data_hora) : null);
  for (const f of batch.failed) add(f.user_id, f.data_hora != null ? String(f.data_hora) : null);
  if (keys.size === 0) return;

  for (const key of keys) {
    const pipe = key.indexOf('|');
    if (pipe < 0) continue;
    const userId = key.slice(0, pipe);
    const date = key.slice(pipe + 1);
    try {
      const { startIso, endIso } = saoPauloCivilBoundsUtc(date);
      const { data: trs, error: e1 } = await supabase
        .from('time_records')
        .select('id,timestamp,type')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .gte('timestamp', startIso)
        .lte('timestamp', endIso)
        .limit(800);
      if (e1) continue;
      const { data: pend, error: e2 } = await supabase
        .from('rep_punch_logs')
        .select('id,data_hora,tipo_marcacao')
        .eq('company_id', companyId)
        .eq('resolved_user_id', userId)
        .is('time_record_id', null)
        .eq('ignored', false)
        .gte('data_hora', startIso)
        .lte('data_hora', endIso)
        .limit(800);
      if (e2) continue;
      const rec = reconcileOperationalDaySequence({
        employeeId: userId,
        date,
        timeRecords: (trs ?? []).map((r) => ({
          id: r.id as string,
          timestamp: r.timestamp as string,
          type: r.type as string,
        })),
        pendingRepPunches: (pend ?? []).map((r) => ({
          id: r.id as string,
          data_hora: r.data_hora as string,
          tipo_marcacao: (r.tipo_marcacao as string | null) ?? null,
        })),
      });
      const pendingCount = pend?.length ?? 0;
      const promotedSameDay = batch.promoted.filter((p) => {
        const u = String(p.user_id ?? '').trim();
        const y = p.data_hora != null ? repCivilDateFromIsoUtc(String(p.data_hora)) : null;
        return u === userId && y === date;
      }).length;
      const failedSameDay = batch.failed.filter((f) => {
        const u = String(f.user_id ?? '').trim();
        const y = f.data_hora != null ? repCivilDateFromIsoUtc(String(f.data_hora)) : null;
        return u === userId && y === date;
      }).length;
      const partial = pendingCount > 0 && (promotedSameDay > 0 || (trs?.length ?? 0) > 0);

      if (typeof globalThis !== 'undefined' && globalThis.console) {
        globalThis.console.info('[REP DAY RECONCILIATION]', {
          employee_id: userId,
          date,
          pending_rep_in_mirror_day: pendingCount,
          mirror_records_in_day: trs?.length ?? 0,
          issues: rec.issues.length,
          batch_promoted_this_window: promotedSameDay,
          batch_failed_this_window: failedSameDay,
          partial_day: partial,
        });
      }
      for (const iss of rec.issues) {
        if (typeof globalThis !== 'undefined' && globalThis.console) {
          if (iss.kind === 'sequence_gap') {
            globalThis.console.warn('[REP SEQUENCE GAP]', {
              employee_id: userId,
              date,
              ...iss,
            });
          }
          if (iss.kind === 'duplicate_entry') {
            globalThis.console.warn('[REP DUPLICATE ENTRY DETECTED]', {
              employee_id: userId,
              date,
              ...iss,
            });
          }
        }
      }
    } catch {
      /* logging only */
    }
  }
}

function repPunchIngestGroupKey(p: PunchFromDevice): string {
  const pis = (p.pis ?? '').trim();
  const cpf = (p.cpf ?? '').trim();
  const mat = (p.matricula ?? '').trim();
  if (pis || cpf || mat) return `i:${pis}|${cpf}|${mat}`;
  return `u:${p.nsr ?? 'x'}:${p.data_hora}`;
}

export type PromotePendingRepPunchLogsOptions = {
  /** Inclusivo; mesmo critério que «só hoje» no sync (calendário local → ISO). */
  localWindow?: { startIso: string; endIso: string } | null;
  /** Só cria espelho se o colaborador resolvido pelo AFD for este; outras batidas ficam na fila. */
  onlyUserId?: string | null;
  /** Promove apenas este id de rep_punch_logs (ex.: após vínculo manual). */
  onlyRepPunchLogId?: string | null;
};

/**
 * Cria registros de ponto (time_records) para marcações que ficaram só em rep_punch_logs (modo staging).
 */
export async function promotePendingRepPunchLogs(
  supabase: SupabaseClient,
  companyId: string,
  repDeviceId: string,
  options?: PromotePendingRepPunchLogsOptions
): Promise<{
  success: boolean;
  promoted?: number;
  promoteFailed?: number;
  promoteFailedInvalidSequence?: number;
  promoteFailedRejected?: number;
  promoteFailedDetail?: RepPromoteFailedDetailRow[];
  skippedNoUser?: number;
  /** Com filtro por colaborador: batidas que casa(m) com outro utilizador. */
  skippedOtherUser?: number;
  error?: string;
}> {
  const win = options?.localWindow;
  const onlyUid = options?.onlyUserId?.trim();
  const onlyLog = options?.onlyRepPunchLogId?.trim();
  const { data, error } = await supabase.rpc('rep_promote_pending_rep_punch_logs', {
    p_company_id: companyId.trim(),
    p_rep_device_id: repDeviceId,
    p_local_window_start: win?.startIso ?? null,
    p_local_window_end: win?.endIso ?? null,
    p_only_user_id: onlyUid && onlyUid.length > 0 ? onlyUid : null,
    p_only_rep_punch_log_id: onlyLog && onlyLog.length > 0 ? onlyLog : null,
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const row = data as {
    success?: boolean;
    promoted?: number;
    promote_failed?: number;
    promote_failed_invalid_sequence?: number;
    promote_failed_rejected?: number;
    promote_failed_detail?: RepPromoteFailedDetailRow[] | null;
    rep_promote_recovered_detail?: RepPromoteRecoveredDetailRow[] | null;
    skipped_no_user?: number;
    skipped_other_user?: number;
    promoted_detail?: RepPromotedDetailRow[] | null;
  };
  const failedRows = row.promote_failed_detail ?? [];
  if (row.success === true && Array.isArray(row.promoted_detail) && row.promoted_detail.length > 0) {
    try {
      await syncEspelhoAfterRepPromote(supabase, companyId.trim(), row.promoted_detail);
    } catch (e) {
      console.error('[TIMESHEET FAIL]', {
        motivo: e instanceof Error ? e.message : String(e),
        contexto: 'syncEspelhoAfterRepPromote',
        company_id: companyId.trim(),
      });
    }
  }

  if (row.success === true) {
    const snu = row.skipped_no_user ?? 0;
    const sou = row.skipped_other_user ?? 0;
    if (snu > 0) {
      enqueueAppendTimeAttendanceTimelineEvent({
        companyId: companyId.trim(),
        eventType: TimeAttendanceTimelineEventType.REP_MATCH_FAILED,
        eventSeverity: TimeAttendanceTimelineSeverity.medium,
        sourceModule: 'rep_promote_pending_rep_punch_logs',
        sourceReferenceId: repDeviceId,
        payload: { aggregate: true, skipped_no_user: snu },
        supabaseClient: supabase,
      });
    }
    if (sou > 0) {
      enqueueAppendTimeAttendanceTimelineEvent({
        companyId: companyId.trim(),
        eventType: TimeAttendanceTimelineEventType.REP_MATCH_AMBIGUOUS,
        eventSeverity: TimeAttendanceTimelineSeverity.medium,
        sourceModule: 'rep_promote_pending_rep_punch_logs',
        sourceReferenceId: repDeviceId,
        payload: { aggregate: true, skipped_other_user: sou },
        supabaseClient: supabase,
      });
    }
    const pf = row.promote_failed ?? 0;
    if (pf > 0 && typeof globalThis !== 'undefined' && globalThis.console) {
      globalThis.console.info('[REP PROMOTE RETRY]', {
        promote_failed: pf,
        note: 'Sem retry automático imediato para invalid_sequence / período fechado / NSR duplicado; missing_user após vínculo manual.',
        rep_device_id: repDeviceId,
      });
    }
    if (failedRows.length > 0 && failedRows.length <= 12) {
      for (const fr of failedRows) {
        const uid = String(fr.user_id ?? '').trim();
        const iso = fr.data_hora != null ? String(fr.data_hora) : '';
        const ymd = iso ? repCivilDateFromIsoUtc(iso) : null;
        const attempts =
          typeof fr.promotion_attempts === 'number' ? fr.promotion_attempts : null;
        if ((attempts ?? 0) > 1) {
          enqueueAppendTimeAttendanceTimelineEvent({
            companyId: companyId.trim(),
            employeeId: uid || null,
            date: ymd,
            eventType: TimeAttendanceTimelineEventType.REP_PROMOTE_RETRIED,
            eventSeverity: TimeAttendanceTimelineSeverity.low,
            sourceModule: 'rep_promote_pending_rep_punch_logs',
            sourceReferenceId: String(fr.rep_punch_log_id ?? repDeviceId),
            payload: {
              error_code: fr.error_code ?? null,
              nsr: fr.nsr ?? null,
              promotion_attempts: attempts,
              rep_punch_log_id: fr.rep_punch_log_id ?? null,
            },
            supabaseClient: supabase,
          });
        }
        recordRepPromoteMirrorFailureOnTimeline(supabase, {
          companyId: companyId.trim(),
          employeeId: uid || null,
          date: ymd,
          nsr: fr.nsr,
          message: fr.message ?? null,
          errorCode: fr.error_code ?? null,
          repPunchLogId: fr.rep_punch_log_id != null ? String(fr.rep_punch_log_id) : null,
          sourceModule: 'rep_promote_pending_rep_punch_logs',
          sourceReferenceId: repDeviceId,
          promotionAttempts: attempts,
          deviceId: repDeviceId,
        });
      }
    } else if (failedRows.length > 12) {
      enqueueAppendTimeAttendanceTimelineEvent({
        companyId: companyId.trim(),
        eventType: TimeAttendanceTimelineEventType.REP_PROMOTE_FAILED,
        eventSeverity: TimeAttendanceTimelineSeverity.medium,
        sourceModule: 'rep_promote_pending_rep_punch_logs',
        sourceReferenceId: repDeviceId,
        payload: {
          aggregate: true,
          promote_failed: pf,
          sample: failedRows[0],
          category: 'REP',
        },
        supabaseClient: supabase,
      });
      enqueueAppendTimeAttendanceTimelineEvent({
        companyId: companyId.trim(),
        eventType: TimeAttendanceTimelineEventType.INCIDENT_DETECTED,
        eventSeverity: TimeAttendanceTimelineSeverity.medium,
        sourceModule: 'rep_promote_pending_rep_punch_logs',
        sourceReferenceId: repDeviceId,
        payload: {
          rep_promote_failure: true,
          aggregate: true,
          promote_failed: pf,
          category: 'REP',
        },
        supabaseClient: supabase,
      });
    }

    if ((row.promoted_detail?.length ?? 0) > 0 || failedRows.length > 0) {
      void logRepOperationalReconciliationForPromoteBatch(supabase, companyId.trim(), {
        promoted: row.promoted_detail ?? [],
        failed: failedRows,
      });
    }

    const recovered = row.rep_promote_recovered_detail ?? [];
    for (const rc of recovered) {
      const uid = String(rc.user_id ?? '').trim();
      const iso = rc.data_hora != null ? String(rc.data_hora) : '';
      const ymd = iso ? repCivilDateFromIsoUtc(iso) : null;
      if (typeof globalThis !== 'undefined' && globalThis.console) {
        globalThis.console.info('[REP PROMOTE RECOVERED]', {
          nsr: rc.nsr ?? null,
          employee_id: uid || null,
          date: ymd,
          previous_error_code: rc.previous_error_code ?? null,
        });
      }
      enqueueAppendTimeAttendanceTimelineEvent({
        companyId: companyId.trim(),
        employeeId: uid || null,
        date: ymd,
        eventType: TimeAttendanceTimelineEventType.REP_PROMOTE_RECOVERED,
        eventSeverity: TimeAttendanceTimelineSeverity.info,
        sourceModule: 'rep_promote_pending_rep_punch_logs',
        sourceReferenceId: String(rc.rep_punch_log_id ?? repDeviceId),
        payload: {
          nsr: rc.nsr ?? null,
          previous_error_code: rc.previous_error_code ?? null,
          rep_punch_log_id: rc.rep_punch_log_id ?? null,
        },
        supabaseClient: supabase,
      });
    }

    if (recovered.length > 0) {
      void import('../../src/services/repOperationalIntegrity.service').then((m) =>
        m.runRepGovernanceAfterPromoteRecoveredBatch(supabase, companyId.trim(), recovered).catch((err) => {
          console.error('[repService] runRepGovernanceAfterPromoteRecoveredBatch', err);
        }),
      );
    }

    const det = row.promoted_detail ?? [];
    if (det.length > 0 && det.length <= 8) {
      for (const d of det) {
        const uid = String(d.user_id ?? '').trim();
        const iso = d.data_hora != null ? String(d.data_hora) : '';
        const ymd = iso ? repCivilDateFromIsoUtc(iso) : null;
        enqueueAppendTimeAttendanceTimelineEvent({
          companyId: companyId.trim(),
          employeeId: uid || null,
          date: ymd,
          eventType: TimeAttendanceTimelineEventType.REP_PROMOTED,
          eventSeverity: TimeAttendanceTimelineSeverity.info,
          sourceModule: 'rep_promote_pending_rep_punch_logs',
          sourceReferenceId: repDeviceId,
          payload: {
            nsr: d.nsr ?? null,
            resolved_user_id: uid || null,
            canonical_user_id: uid || null,
            data_hora: iso || null,
            device_id: repDeviceId,
          },
          supabaseClient: supabase,
        });
      }
    } else if (det.length > 8) {
      enqueueAppendTimeAttendanceTimelineEvent({
        companyId: companyId.trim(),
        eventType: TimeAttendanceTimelineEventType.REP_PROMOTED,
        eventSeverity: TimeAttendanceTimelineSeverity.info,
        sourceModule: 'rep_promote_pending_rep_punch_logs',
        sourceReferenceId: repDeviceId,
        payload: {
          aggregate: true,
          promoted_count: det.length,
          sample_nsr: det[0]?.nsr ?? null,
        },
        supabaseClient: supabase,
      });
    }
  }

  return {
    success: row.success === true,
    promoted: row.promoted,
    promoteFailed: row.promote_failed,
    promoteFailedInvalidSequence: row.promote_failed_invalid_sequence,
    promoteFailedRejected: row.promote_failed_rejected,
    promoteFailedDetail: failedRows.length ? failedRows : undefined,
    skippedNoUser: row.skipped_no_user,
    skippedOtherUser: row.skipped_other_user,
  };
}

/**
 * Admin: associa colaborador a batida sem match e promove (RPC + espelho).
 */
export async function linkUnresolvedRepPunchAndPromote(
  supabase: SupabaseClient,
  companyId: string,
  repPunchLogId: string,
  userId: string,
): Promise<{
  success: boolean;
  promoted?: number;
  error?: string;
  manualLinked?: boolean;
}> {
  const { data, error } = await supabase.rpc('rep_admin_link_unresolved_punch', {
    p_rep_punch_log_id: repPunchLogId.trim(),
    p_user_id: userId.trim(),
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const row = data as {
    success?: boolean;
    promoted?: number;
    skipped_no_user?: number;
    skipped_other_user?: number;
    skipped_unresolved_identity?: number;
    promoted_detail?: RepPromotedDetailRow[] | null;
    error?: string;
    manual_linked?: boolean;
  };
  if (row.success !== true) {
    return { success: false, error: String(row.error ?? 'Falha ao vincular') };
  }
  if (Array.isArray(row.promoted_detail) && row.promoted_detail.length > 0) {
    try {
      await syncEspelhoAfterRepPromote(supabase, companyId.trim(), row.promoted_detail);
    } catch (e) {
      console.error('[TIMESHEET FAIL]', {
        motivo: e instanceof Error ? e.message : String(e),
        contexto: 'syncEspelhoAfterRepPromote (manual link)',
        company_id: companyId.trim(),
      });
    }
  }
  enqueueAppendTimeAttendanceTimelineEvent({
    companyId: companyId.trim(),
    employeeId: userId.trim(),
    eventType: TimeAttendanceTimelineEventType.MANUAL_ADJUSTMENT,
    eventSeverity: TimeAttendanceTimelineSeverity.low,
    sourceModule: 'repService.linkUnresolvedRepPunchAndPromote',
    sourceReferenceId: repPunchLogId.trim(),
    payload: {
      action: 'rep_manual_link',
      rep_punch_log_id: repPunchLogId.trim(),
      promoted: row.promoted ?? 0,
      manual_linked: row.manual_linked === true,
    },
    supabaseClient: supabase,
  });
  const detl = row.promoted_detail ?? [];
  if (detl.length > 0) {
    enqueueAppendTimeAttendanceTimelineEvent({
      companyId: companyId.trim(),
      employeeId: userId.trim(),
      eventType: TimeAttendanceTimelineEventType.REP_PROMOTED,
      eventSeverity: TimeAttendanceTimelineSeverity.info,
      sourceModule: 'repService.linkUnresolvedRepPunchAndPromote',
      sourceReferenceId: repPunchLogId.trim(),
      payload: { aggregate: true, count: detl.length, after_manual_link: true },
      supabaseClient: supabase,
    });
  }
  return {
    success: true,
    promoted: row.promoted,
    manualLinked: row.manual_linked === true,
  };
}

/**
 * Registra log de integração REP
 */
export async function logRepAction(
  supabase: SupabaseClient,
  repDeviceId: string | null,
  acao: string,
  status: 'sucesso' | 'erro' | 'parcial',
  mensagem?: string,
  detalhes?: Record<string, unknown>
): Promise<void> {
  await supabase.from('rep_logs').insert({
    rep_device_id: repDeviceId,
    acao,
    status,
    mensagem: mensagem ?? null,
    detalhes: detalhes ?? {},
  });
}

/**
 * Atualiza ultima_sincronizacao do dispositivo
 */
export async function updateDeviceLastSync(
  supabase: SupabaseClient,
  deviceId: string,
  status: 'ativo' | 'erro' | 'sincronizando'
): Promise<void> {
  await supabase
    .from('rep_devices')
    .update({
      ultima_sincronizacao: new Date().toISOString(),
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deviceId);
}
