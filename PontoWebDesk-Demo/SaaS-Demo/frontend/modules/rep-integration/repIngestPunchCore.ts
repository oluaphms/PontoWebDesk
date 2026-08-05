import { observabilityConsole } from '../../src/shared/logger/observabilityConsole';
/**
 * Núcleo de ingestão REP (RPC rep_ingest_punch + timeline opcional).
 * Ficheiro separado para o POST /api/rep/punch poder importar só isto sem carregar repService inteiro (sync batch, timeEngine, etc.).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeRepExtractedIdentifiersIntoRawData } from './repExtractBestIdentifier';
import { extractCompactAfdLineFromRawData, repPunchLogEffectivePisCanonForDiagnostics } from './repPunchPendingIdentity';
import { matriculaFromAfdPisField, parseAfdLine } from './repParser';
import { normalizeDigits, normalizeDocument, validatePisPasep11 } from './pisPasep';
import type { RepWeakPisMatchUser } from './repWeakPisFallbackMatch';
import {
  applyResolvedIdentityToRaw,
  applyUnresolvedIdentityToRaw,
  resolveCanonicalUser,
} from './repResolveCanonicalUser';
import { repUsersSelectColListForServer } from './repUsersSelectServer';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from '../../src/services/timeAttendanceTimeline.constants';
import { classifyRepPromoteError, type RepPromoteErrorType } from './repPromoteErrorClassifier';

type AppendTimelineInput = import('../../src/services/timeAttendanceTimeline.service').AppendTimeAttendanceTimelineEventInput;

function enqueueAppendTimeAttendanceTimelineEvent(input: AppendTimelineInput): void {
  void import('../../src/services/timeAttendanceTimeline.service').then((m) =>
    m.appendTimeAttendanceTimelineEvent(input).catch((err) => {
      observabilityConsole.error('[repIngestPunchCore] appendTimeAttendanceTimelineEvent', err);
    }),
  );
}

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

export async function fetchWeakMatchUsersForCompany(
  supabase: SupabaseClient,
  companyId: string,
): Promise<RepWeakPisMatchUser[]> {
  const cols = await repUsersSelectColListForServer(supabase, [...REP_WEAK_MATCH_USER_COLUMNS]);
  const { data: wu, error } = await supabase
    .from('users')
    .select(cols.join(','))
    .eq('company_id', companyId.trim())
    .limit(5000);
  if (error) {
    observabilityConsole.error('[USERS QUERY ERROR]', error);
    return [];
  }
  return (wu as unknown as RepWeakPisMatchUser[] | null) ?? [];
}

function extractRepAfdLineFromRawData(rd: Record<string, unknown>): string | null {
  return extractCompactAfdLineFromRawData(rd);
}

function pisDigits11(s: string | null | undefined): string {
  return normalizeDocument(s ?? '').padStart(11, '0').slice(0, 11);
}

export function repCivilDateFromIsoUtc(iso: string): string | null {
  try {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return new Date(t).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

const STABLE_PROMOTE_CODES = new Set<string>([
  'invalid_sequence',
  'duplicate_nsr',
  'closed_period',
  'protected_timesheet',
  'missing_user',
  'unknown',
]);

function normalizeRepPromoteErrorCode(
  raw: string | null | undefined,
  message: string | null | undefined,
): RepPromoteErrorType {
  const r = (raw ?? '').trim();
  if (r && STABLE_PROMOTE_CODES.has(r)) return r as RepPromoteErrorType;
  return classifyRepPromoteError(message);
}

/** Timeline + incidente operacional quando o espelho rejeita a batida (evidência fica em rep_punch_logs). */
export function recordRepPromoteMirrorFailureOnTimeline(
  supabase: SupabaseClient,
  args: {
    companyId: string;
    employeeId: string | null;
    date: string | null;
    nsr: number | null | undefined;
    message: string | null | undefined;
    errorCode?: string | null;
    repPunchLogId?: string | null;
    sourceModule: string;
    sourceReferenceId?: string | null;
    promotionAttempts?: number | null;
    deviceId?: string | null;
  },
): void {
  const msg = args.message ?? '';
  const code = normalizeRepPromoteErrorCode(args.errorCode, msg);
  if (typeof globalThis !== 'undefined' && globalThis.console) {
    observabilityConsole.warn('[REP PROMOTE FAILED]', {
      nsr: args.nsr ?? null,
      error_code: code,
      employee_id: args.employeeId ?? null,
      date: args.date ?? null,
      rep_punch_log_id: args.repPunchLogId ?? null,
    });
  }
  const payload: Record<string, unknown> = {
    error_code: code,
    message: msg ? msg.slice(0, 2000) : null,
    nsr: args.nsr ?? null,
    employee_id: args.employeeId ?? null,
    date: args.date ?? null,
    category: 'REP',
    rep_punch_log_id: args.repPunchLogId ?? null,
    promotion_attempts: args.promotionAttempts ?? null,
    device_id: args.deviceId ?? null,
  };
  enqueueAppendTimeAttendanceTimelineEvent({
    companyId: args.companyId,
    employeeId: args.employeeId,
    date: args.date,
    eventType: TimeAttendanceTimelineEventType.REP_PROMOTE_FAILED,
    eventSeverity: TimeAttendanceTimelineSeverity.medium,
    sourceModule: args.sourceModule,
    sourceReferenceId: args.repPunchLogId ?? args.sourceReferenceId ?? null,
    payload,
    supabaseClient: supabase,
  });
  enqueueAppendTimeAttendanceTimelineEvent({
    companyId: args.companyId,
    employeeId: args.employeeId,
    date: args.date,
    eventType: TimeAttendanceTimelineEventType.INCIDENT_DETECTED,
    eventSeverity: TimeAttendanceTimelineSeverity.medium,
    sourceModule: args.sourceModule,
    sourceReferenceId: args.repPunchLogId ?? args.sourceReferenceId ?? null,
    payload: { rep_promote_failure: true, ...payload },
    supabaseClient: supabase,
  });
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
    promoteMirrorFailed?: boolean;
    promotionErrorCode?: string | null;
    promoteErrorMessage?: string | null;
    repLogId?: string | null;
    promotionAttempts?: number | null;
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

  enqueueAppendTimeAttendanceTimelineEvent({
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
      promote_mirror_failed: input.promoteMirrorFailed === true,
    },
    supabaseClient: supabase,
  });

  if (input.duplicate) return;

  if (input.promoteMirrorFailed) {
    recordRepPromoteMirrorFailureOnTimeline(supabase, {
      companyId: input.company_id,
      employeeId: resolved_user_id,
      date: ymd,
      nsr: input.nsr,
      message: input.promoteErrorMessage ?? null,
      errorCode: input.promotionErrorCode ?? null,
      repPunchLogId: input.repLogId ?? null,
      sourceModule: 'repService.ingestPunch',
      sourceReferenceId: device_id,
      promotionAttempts: input.promotionAttempts ?? null,
      deviceId: device_id,
    });
    return;
  }

  if (input.user_not_found) {
    enqueueAppendTimeAttendanceTimelineEvent({
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
    enqueueAppendTimeAttendanceTimelineEvent({
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
    enqueueAppendTimeAttendanceTimelineEvent({
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

export type RunRepIngestPunchRpcOptions = {
  /** false no POST /api/rep/punch (Vercel) para menos I/O e bundle mais previsível */
  recordTimeline: boolean;
};

export async function runRepIngestPunchRpc(
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
    only_staging?: boolean;
    apply_schedule?: boolean;
    force_user_id?: string | null;
    weak_match_users?: readonly RepWeakPisMatchUser[] | null;
    omitTimeline?: boolean;
  },
  options: RunRepIngestPunchRpcOptions,
): Promise<{
  success: boolean;
  time_record_id?: string;
  user_not_found?: boolean;
  duplicate?: boolean;
  error?: string;
  promoteMirrorFailed?: boolean;
  promotion_error_code?: string;
  rep_log_id?: string;
  promotion_attempts?: number;
}> {
  const recordTimeline = options.recordTimeline && !params.omitTimeline;
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
          observabilityConsole.warn('[REP MATCH FALLBACK] weak_match_applied', { userId: identity.userId });
          observabilityConsole.warn('[REP AUTO MATCH] fallback aplicado', {
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
    promotion_error_code?: string;
    rep_log_id?: string;
    promotion_attempts?: number;
  };
  if (result.duplicate) {
    if (recordTimeline) {
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
    observabilityConsole.warn('[REP INGEST]', {
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
    observabilityConsole.warn('[REP MATCH DEBUG]', {
      pis_recebido: merged.pis ?? null,
      pis_normalizado: eff ?? normalizeDigits(merged.pis ?? merged.cpf),
      cpf: merged.cpf ?? null,
      matricula: merged.matricula ?? null,
      candidatos: 'no cliente admin use RPC rep_match_user_id_for_rep_punch_row → campo debug',
    });
  }
  const promotionCode =
    typeof result.promotion_error_code === 'string' ? result.promotion_error_code.trim() : '';
  const mirrorFailed = result.success === false && promotionCode.length > 0;
  const out = {
    success: result.success === true,
    time_record_id: result.time_record_id,
    user_not_found: result.user_not_found === true,
    error: result.error,
    promoteMirrorFailed: mirrorFailed,
    promotion_error_code: promotionCode || undefined,
    rep_log_id: typeof result.rep_log_id === 'string' ? result.rep_log_id : undefined,
    promotion_attempts:
      typeof result.promotion_attempts === 'number' ? result.promotion_attempts : undefined,
  };
  if (recordTimeline) {
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
      promoteMirrorFailed: mirrorFailed,
      promotionErrorCode: promotionCode || null,
      promoteErrorMessage: result.error ?? null,
      repLogId: typeof result.rep_log_id === 'string' ? result.rep_log_id : null,
      promotionAttempts:
        typeof result.promotion_attempts === 'number' ? result.promotion_attempts : null,
    });
  }
  return out;
}
