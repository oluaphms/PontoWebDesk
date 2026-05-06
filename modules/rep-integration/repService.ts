/**
 * Serviço de integração REP - ingestão de marcações, logs e consolidação em time_records
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedAfdRecord, RepDevice, PunchFromDevice } from './types';
import { mergeRepExtractedIdentifiersIntoRawData } from './repExtractBestIdentifier';
import { extractCompactAfdLineFromRawData, repPunchLogEffectivePisCanonForDiagnostics } from './repPunchPendingIdentity';
import { afdRecordToIsoDateTime, matriculaFromAfdPisField, parseAfdLine } from './repParser';
import { normalizeDigits, normalizeDocument, validatePisPasep11 } from './pisPasep';
import type { RepWeakPisMatchUser } from './repWeakPisFallbackMatch';
import {
  applyResolvedIdentityToRaw,
  applyUnresolvedIdentityToRaw,
  resolveCanonicalUser,
} from './repResolveCanonicalUser';
import { syncEspelhoAfterRepPromote, type RepPromotedDetailRow } from './repTimesheetMirror';
import { safeUserSelectColumns } from '../../services/supabaseClient';
import { appendTimeAttendanceTimelineEvent } from '../../src/services/timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from '../../src/services/timeAttendanceTimeline.constants';

const REP_WEAK_MATCH_USER_COLUMNS = [
  'id',
  'pis_pasep',
  'pis',
  'cpf',
  'status',
  'invisivel',
  'demissao',
  'company_id',
] as const;

async function fetchWeakMatchUsersForCompany(
  supabase: SupabaseClient,
  companyId: string,
): Promise<RepWeakPisMatchUser[]> {
  const cols = await safeUserSelectColumns(supabase, [...REP_WEAK_MATCH_USER_COLUMNS]);
  const { data: wu, error } = await supabase
    .from('users')
    .select(cols.join(','))
    .eq('company_id', companyId.trim())
    .limit(5000);
  if (error) {
    console.error('[USERS QUERY ERROR]', error);
    return [];
  }
  return (wu as RepWeakPisMatchUser[] | null) ?? [];
}

/**
 * Linha AFD compacta tipo 3/7: `raw_data.raw` string ou envelope (`raw` object com `.raw` string), p.ex. clock_event_logs.
 */
function extractRepAfdLineFromRawData(rd: Record<string, unknown>): string | null {
  return extractCompactAfdLineFromRawData(rd);
}

function pisDigits11(s: string | null | undefined): string {
  return normalizeDocument(s ?? '').padStart(11, '0').slice(0, 11);
}

function repCivilDateFromIsoUtc(iso: string): string | null {
  try {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return new Date(t).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function scheduleRepIngestTimeline(
  supabase: SupabaseClient,
  input: {
    company_id: string;
    rep_device_id?: string | null;
    data_hora: string;
    nsr: number | null | undefined;
    rawData: Record<string, unknown>;
    forceUserId: string | null;
    duplicate?: boolean;
    user_not_found?: boolean;
    success: boolean;
    time_record_id?: string | null;
  },
): void {
  const ymd = repCivilDateFromIsoUtc(input.data_hora);
  const match_strategy =
    typeof input.rawData.match_strategy === 'string' ? input.rawData.match_strategy : null;
  const confidence =
    typeof input.rawData.match_confidence === 'string' ? input.rawData.match_confidence : null;
  const canonical_user_id =
    typeof input.rawData.canonical_user_id === 'string' ? input.rawData.canonical_user_id : null;
  const resolved_user_id = input.forceUserId ?? null;
  const device_id = input.rep_device_id ?? null;

  void appendTimeAttendanceTimelineEvent({
    companyId: input.company_id,
    employeeId: resolved_user_id,
    date: ymd,
    eventType: TimeAttendanceTimelineEventType.REP_PUNCH_RECEIVED,
    eventSeverity: TimeAttendanceTimelineSeverity.info,
    sourceModule: 'repService.ingestPunch',
    payload: {
      nsr: input.nsr ?? null,
      match_strategy,
      resolved_user_id,
      canonical_user_id,
      confidence,
      device_id,
      duplicate: input.duplicate === true,
      user_not_found: input.user_not_found === true,
      success: input.success,
      time_record_id: input.time_record_id ?? null,
    },
    supabaseClient: supabase,
  });

  if (input.duplicate) return;

  if (input.user_not_found) {
    void appendTimeAttendanceTimelineEvent({
      companyId: input.company_id,
      employeeId: null,
      date: ymd,
      eventType: TimeAttendanceTimelineEventType.REP_MATCH_FAILED,
      eventSeverity: TimeAttendanceTimelineSeverity.medium,
      sourceModule: 'repService.ingestPunch',
      payload: { nsr: input.nsr ?? null, device_id, match_strategy },
      supabaseClient: supabase,
    });
    return;
  }

  if (input.success && confidence === 'low') {
    void appendTimeAttendanceTimelineEvent({
      companyId: input.company_id,
      employeeId: resolved_user_id,
      date: ymd,
      eventType: TimeAttendanceTimelineEventType.REP_MATCH_AMBIGUOUS,
      eventSeverity: TimeAttendanceTimelineSeverity.medium,
      sourceModule: 'repService.ingestPunch',
      payload: { nsr: input.nsr ?? null, device_id, match_strategy, confidence },
      supabaseClient: supabase,
    });
  }

  if (input.success && input.time_record_id) {
    void appendTimeAttendanceTimelineEvent({
      companyId: input.company_id,
      employeeId: resolved_user_id,
      date: ymd,
      eventType: TimeAttendanceTimelineEventType.REP_MATCH_SUCCESS,
      eventSeverity: TimeAttendanceTimelineSeverity.info,
      sourceModule: 'repService.ingestPunch',
      sourceReferenceId: input.time_record_id,
      payload: { nsr: input.nsr ?? null, device_id, match_strategy },
      supabaseClient: supabase,
    });
  }
}

/**
 * Re-parse da linha AFD em `raw_data.raw` só quando melhora o identificador.
 * Se `pis`/`cpf` já têm PIS com DV válido (ex.: enriquecimento em fetchPunches via load_users),
 * **não** substituir pelo parse do AFD truncado (caso típico Control iD).
 */
function applyControlIdAfdLineIdentityOverride<
  T extends {
    pis?: string | null;
    cpf?: string | null;
    matricula?: string | null;
    raw_data?: Record<string, unknown>;
  },
>(params: T): T {
  const rd = params.raw_data;
  if (!rd || typeof rd !== 'object' || Array.isArray(rd)) return params;
  const line = extractRepAfdLineFromRawData(rd);
  if (!line) return params;
  const rec = parseAfdLine(line);
  if (!rec) return params;

  const incomingPis = pisDigits11(params.pis ?? params.cpf);
  if (validatePisPasep11(incomingPis)) {
    return params;
  }

  const parsedPis = pisDigits11(rec.cpfOuPis);
  if (!validatePisPasep11(parsedPis)) {
    return params;
  }

  const badge = matriculaFromAfdPisField(rec.cpfOuPis);
  const matIn = params.matricula != null && String(params.matricula).trim() !== '' ? params.matricula : null;
  return {
    ...params,
    pis: rec.cpfOuPis,
    cpf: rec.cpfOuPis,
    matricula: matIn ?? badge ?? null,
  };
}

export interface IngestResult {
  success: boolean;
  imported: number;
  duplicated: number;
  userNotFound: number;
  errors: string[];
  /** Marcações só em rep_punch_logs (modo fila temporária) */
  staged?: number;
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
  }
): Promise<{
  success: boolean;
  time_record_id?: string;
  user_not_found?: boolean;
  /** NSR já existia em rep_punch_logs para este relógio. */
  duplicate?: boolean;
  error?: string;
}> {
  const merged = applyControlIdAfdLineIdentityOverride(params);
  let rawData = mergeRepExtractedIdentifiersIntoRawData(merged.raw_data ?? {});
  let pisSend = merged.pis ?? null;
  let cpfSend = merged.cpf ?? null;
  let forceUserId = merged.force_user_id ?? null;

  if (!forceUserId) {
    let weakList = params.weak_match_users;
    if (!weakList?.length) {
      weakList = await fetchWeakMatchUsersForCompany(supabase, merged.company_id);
    }

    const identity = await resolveCanonicalUser(
      supabase,
      {
        company_id: merged.company_id,
        pis: pisSend,
        cpf: cpfSend,
        matricula: merged.matricula ?? null,
        raw_data: rawData,
      },
      { users: weakList ?? [] }
    );

    if (identity.userId) {
      forceUserId = identity.userId;
      rawData = applyResolvedIdentityToRaw(rawData, identity.userId);
      if (identity.source === 'weak' && identity.canonicalPis) {
        pisSend = identity.canonicalPis;
        cpfSend = identity.canonicalPis;
        rawData = {
          ...rawData,
          match_confidence: 'low',
          corrected_by_system: true,
          weak_match_applied: true,
          matched_user_id: identity.userId,
          match_strategy: 'fallback',
        };
        if (typeof globalThis !== 'undefined' && globalThis.console) {
          globalThis.console.warn('[REP MATCH FALLBACK] weak_match_applied', { userId: identity.userId });
          globalThis.console.warn('[REP AUTO MATCH] fallback aplicado', {
            userId: identity.userId,
            match_strategy: 'fallback',
          });
        }
      }
    } else {
      rawData = applyUnresolvedIdentityToRaw(rawData);
    }
  } else {
    rawData = applyResolvedIdentityToRaw(rawData, forceUserId);
  }

  const { data, error } = await supabase.rpc('rep_ingest_punch', {
    p_company_id: merged.company_id,
    p_rep_device_id: merged.rep_device_id ?? null,
    p_pis: pisSend,
    p_cpf: cpfSend,
    p_matricula: merged.matricula ?? null,
    p_nome_funcionario: merged.nome_funcionario ?? null,
    p_data_hora: merged.data_hora,
    p_tipo_marcacao: merged.tipo_marcacao,
    p_nsr: merged.nsr ?? null,
    p_raw_data: rawData,
    p_only_staging: merged.only_staging ?? false,
    p_apply_schedule: merged.apply_schedule ?? false,
    p_force_user_id: forceUserId,
    p_trust_client_identity: true,
  });

  if (error) {
    return { success: false, error: error.message };
  }
  const result = data as {
    success?: boolean;
    time_record_id?: string;
    user_not_found?: boolean;
    error?: string;
    duplicate?: boolean;
  };
  if (result.duplicate) {
    if (!params.omitTimeline) {
      scheduleRepIngestTimeline(supabase, {
        company_id: merged.company_id,
        rep_device_id: merged.rep_device_id,
        data_hora: merged.data_hora,
        nsr: merged.nsr,
        rawData,
        forceUserId,
        duplicate: true,
        success: true,
      });
    }
    return { success: true, duplicate: true, error: 'NSR já importado' };
  }

  if (typeof globalThis !== 'undefined' && globalThis.console) {
    const status = forceUserId ? 'resolved' : 'unresolved';
    globalThis.console.warn('[REP INGEST]', {
      nsr: merged.nsr ?? null,
      resolved_user_id: forceUserId ?? null,
      status,
    });
  }

  if (result.user_not_found === true && typeof globalThis !== 'undefined' && globalThis.console) {
    const eff = repPunchLogEffectivePisCanonForDiagnostics({
      pis: pisSend,
      cpf: cpfSend,
      raw_data: rawData,
    });
    globalThis.console.warn('[REP MATCH DEBUG]', {
      pis_recebido: merged.pis ?? null,
      pis_normalizado: eff ?? normalizeDigits(merged.pis ?? merged.cpf),
      cpf: merged.cpf ?? null,
      matricula: merged.matricula ?? null,
      candidatos: 'no cliente admin use RPC rep_match_user_id_for_rep_punch_row → campo debug',
    });
  }
  const out = {
    success: result.success === true,
    time_record_id: result.time_record_id,
    user_not_found: result.user_not_found === true,
    error: result.error,
  };
  if (!params.omitTimeline) {
    scheduleRepIngestTimeline(supabase, {
      company_id: merged.company_id,
      rep_device_id: merged.rep_device_id,
      data_hora: merged.data_hora,
      nsr: merged.nsr,
      rawData,
      forceUserId,
      success: out.success,
      user_not_found: out.user_not_found === true,
      time_record_id: out.time_record_id ?? null,
    });
  }
  return out;
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
  const result: IngestResult = { success: true, imported: 0, duplicated: 0, userNotFound: 0, errors: [] };

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

  void appendTimeAttendanceTimelineEvent({
    companyId: companyId.trim(),
    eventType: TimeAttendanceTimelineEventType.REP_PUNCH_RECEIVED,
    eventSeverity: TimeAttendanceTimelineSeverity.info,
    sourceModule: 'repService.ingestAfdRecords',
    payload: {
      batch_summary: true,
      imported: result.imported,
      duplicated: result.duplicated,
      userNotFound: result.userNotFound,
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
  };
  const onlyStaging = options?.onlyStaging ?? false;
  const applySchedule = options?.applySchedule ?? false;
  const concurrency = getRepIngestConcurrency();
  const onBatchProgress = options?.onBatchProgress;
  let weakUsers: RepWeakPisMatchUser[] | null = null;
  if (!options?.skipWeakPisMatch) {
    weakUsers = await fetchWeakMatchUsersForCompany(supabase, device.company_id);
  }
  const total = punches.length;
  const totalBatches = total > 0 ? Math.ceil(total / concurrency) : 0;
  /** Máximo de callbacks de progresso (importações enormes). */
  const maxProgressSamples = 50;
  const progressStep =
    totalBatches <= maxProgressSamples ? 1 : Math.max(1, Math.ceil(totalBatches / maxProgressSamples));

  for (let i = 0; i < punches.length; i += concurrency) {
    const slice = punches.slice(i, i + concurrency);
    const batch = await Promise.all(
      slice.map((p) =>
        ingestPunch(supabase, {
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
        })
      )
    );
    for (const r of batch) {
      foldIngestPunchRow(r, onlyStaging, result);
    }
    if (onBatchProgress && totalBatches > 0) {
      const batchIndex = Math.floor(i / concurrency) + 1;
      const processedCount = Math.min(i + slice.length, total);
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
    if (i + concurrency < punches.length) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }

  void appendTimeAttendanceTimelineEvent({
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
      errors_count: result.errors.length,
    },
    supabaseClient: supabase,
  });

  return result;
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
    skipped_no_user?: number;
    skipped_other_user?: number;
    promoted_detail?: RepPromotedDetailRow[] | null;
  };
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
      void appendTimeAttendanceTimelineEvent({
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
      void appendTimeAttendanceTimelineEvent({
        companyId: companyId.trim(),
        eventType: TimeAttendanceTimelineEventType.REP_MATCH_AMBIGUOUS,
        eventSeverity: TimeAttendanceTimelineSeverity.medium,
        sourceModule: 'rep_promote_pending_rep_punch_logs',
        sourceReferenceId: repDeviceId,
        payload: { aggregate: true, skipped_other_user: sou },
        supabaseClient: supabase,
      });
    }
    const det = row.promoted_detail ?? [];
    if (det.length > 0 && det.length <= 8) {
      for (const d of det) {
        const uid = String(d.user_id ?? '').trim();
        const iso = d.data_hora != null ? String(d.data_hora) : '';
        const ymd = iso ? repCivilDateFromIsoUtc(iso) : null;
        void appendTimeAttendanceTimelineEvent({
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
      void appendTimeAttendanceTimelineEvent({
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
  void appendTimeAttendanceTimelineEvent({
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
    void appendTimeAttendanceTimelineEvent({
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
