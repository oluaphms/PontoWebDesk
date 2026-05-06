/**
 * Promove linhas de `clock_event_logs` para o espelho (`time_records`) via RPC `rep_ingest_punch`.
 * Identificação do colaborador: employee_id (PIS/CPF 11 dígitos ou matrícula) + company_id.
 */

import type { SupabaseRestConfig } from './supabaseRest';
import { restGet, restPatch, restRpc } from './supabaseRest';
import { mergeRepExtractedIdentifiersIntoRawData } from '../../modules/rep-integration/repExtractBestIdentifier';
import {
  normalizeDocument,
  repAfdCanonical11DigitsFromBlob,
  validatePisPasep11,
} from '../../modules/rep-integration/pisPasep';
import { repPunchLogEffectivePisCanonForDiagnostics } from '../../modules/rep-integration/repPunchPendingIdentity';
import type { RepWeakPisMatchUser } from '../../modules/rep-integration/repWeakPisFallbackMatch';
import {
  applyResolvedIdentityToRaw,
  applyUnresolvedIdentityToRaw,
  resolveCanonicalUserWithMatcher,
} from '../../modules/rep-integration/repResolveCanonicalUser';

export interface ClockEventLogRow {
  id: string;
  employee_id: string;
  occurred_at: string;
  event_type: string;
  company_id: string;
  device_id: string;
  raw: Record<string, unknown> | null;
  promoted_at?: string | null;
  time_record_id?: string | null;
  promote_error?: string | null;
}

export interface PromoteEspelhoResult {
  processed: number;
  timeRecords: number;
  userNotFound: number;
  duplicate: number;
  errors: number;
}

function eventTypeToRepTipo(eventType: string): string {
  const t = (eventType || '').toLowerCase().trim();
  if (t.startsWith('saida') || t.startsWith('saída')) return 'S';
  if (t.startsWith('entrada')) return 'E';
  if (t.startsWith('pausa')) return 'P';
  if (t.startsWith('batida')) return 'B'; // Genérico: backend interpreta pela escala
  const c = (eventType || 'B').toUpperCase().charAt(0); // Padrão 'B' (batida genérica)
  if (c === 'S' || c === 'E' || c === 'P' || c === 'B') return c;
  return 'B';
}

/**
 * Converte employee_id (PIS/CPF/crachá) para os campos da RPC rep_ingest_punch.
 * Usa `repAfdCanonical11DigitsFromBlob` (alinhado a `public.rep_afd_canonical_11_digits` no Supabase).
 */
function employeeFields(employeeId: string): { pis: string | null; cpf: string | null; matricula: string | null } {
  const trimmed = String(employeeId || '').trim();
  const digits = normalizeDocument(trimmed);

  let pisCanonical: string | null = null;
  if (digits.length > 0) {
    pisCanonical = repAfdCanonical11DigitsFromBlob(digits);
  }

  // Se temos um PIS canônico de 11 dígitos, usa como PIS/CPF
  if (pisCanonical && pisCanonical.length === 11) {
    return { pis: pisCanonical, cpf: pisCanonical, matricula: null };
  }

  // Se tem menos de 11 dígitos após limpar, trata como matrícula
  if (digits.length > 0 && digits.length < 11) {
    return { pis: null, cpf: null, matricula: trimmed };
  }

  // Fallback para IDs não numéricos
  if (trimmed && trimmed !== 'unknown') {
    return { pis: null, cpf: null, matricula: trimmed };
  }

  return { pis: null, cpf: null, matricula: null };
}

function nsrFromRaw(raw: Record<string, unknown> | null | undefined): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw.nsr;
  if (typeof n === 'number' && Number.isFinite(n)) return Math.floor(n);
  if (typeof n === 'string' && /^\d+$/.test(n)) return parseInt(n, 10);
  return null;
}

function asUuidOrNull(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

function unwrapRpcResult(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null) {
    const o = raw[0] as Record<string, unknown>;
    const inner = o.rep_ingest_punch;
    if (inner && typeof inner === 'object') return inner as Record<string, unknown>;
    return o;
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

/**
 * Processa eventos ainda não promovidos (`promoted_at` nulo) para a empresa/dispositivo.
 */
export async function promoteClockEventsToEspelho(
  cfg: SupabaseRestConfig,
  opts: {
    timeLogsTable: string;
    companyId: string;
    deviceId: string;
    batchSize?: number;
    maxBatches?: number;
  }
): Promise<PromoteEspelhoResult> {
  const table = opts.timeLogsTable;
  const batch = Math.min(500, Math.max(1, opts.batchSize ?? 200));
  const maxBatches = Math.min(500, Math.max(1, opts.maxBatches ?? 100));
  const out: PromoteEspelhoResult = {
    processed: 0,
    timeRecords: 0,
    userNotFound: 0,
    duplicate: 0,
    errors: 0,
  };

  let weakUsersCache: RepWeakPisMatchUser[] | null = null;
  const loadWeakUsers = async (): Promise<RepWeakPisMatchUser[]> => {
    if (weakUsersCache) return weakUsersCache;
    const selectVariants = [
      'id,cpf,company_id,pis,pis_pasep,status,invisivel,demissao',
      'id,cpf,company_id,pis,pis_pasep',
      'id,cpf,company_id,pis',
      'id,cpf,company_id',
    ];
    for (const select of selectVariants) {
      const path = [
        `users?company_id=eq.${encodeURIComponent(opts.companyId)}`,
        `select=${encodeURIComponent(select)}`,
        'limit=5000',
      ].join('&');
      try {
        weakUsersCache = (await restGet<RepWeakPisMatchUser[]>(cfg, path)) ?? [];
        return weakUsersCache;
      } catch (e) {
        console.error('[USERS QUERY ERROR]', e);
      }
    }
    weakUsersCache = [];
    return weakUsersCache;
  };

  for (let round = 0; round < maxBatches; round++) {
    const q = [
      `${table}?company_id=eq.${encodeURIComponent(opts.companyId)}`,
      `device_id=eq.${encodeURIComponent(opts.deviceId)}`,
      'promoted_at=is.null',
      `select=id,employee_id,occurred_at,event_type,company_id,device_id,raw`,
      `order=occurred_at.asc`,
      `limit=${batch}`,
    ].join('&');

    let rows: ClockEventLogRow[];
    try {
      rows = (await restGet<ClockEventLogRow[]>(cfg, q)) ?? [];
    } catch {
      break;
    }
    if (rows.length === 0) break;

    const weakUsers = await loadWeakUsers();

    for (const ev of rows) {
      const empFields = employeeFields(ev.employee_id);
      const rawObj = ev.raw && typeof ev.raw === 'object' ? (ev.raw as Record<string, unknown>) : {};
      const effPis = repPunchLogEffectivePisCanonForDiagnostics({
        pis: empFields.pis,
        cpf: empFields.cpf,
        raw_data: rawObj,
      });
      const usePis =
        effPis != null && validatePisPasep11(effPis) ? effPis : empFields.pis;
      const useCpf =
        effPis != null && validatePisPasep11(effPis) ? effPis : empFields.cpf;
      const pis = usePis;
      const cpf = useCpf;
      const matricula = empFields.matricula;
      const tipo = eventTypeToRepTipo(ev.event_type);
      const nsr = nsrFromRaw(ev.raw);
      let rawData: Record<string, unknown> = mergeRepExtractedIdentifiersIntoRawData({
        ...rawObj,
        clock_event_log_id: ev.id,
        clock_device_id: ev.device_id,
      });
      const repDeviceId = asUuidOrNull(ev.device_id);

      let pisRpc = pis;
      let cpfRpc = cpf;
      let forceUserId: string | null = null;

      const identity = await resolveCanonicalUserWithMatcher(
        {
          company_id: ev.company_id,
          pis: pisRpc,
          cpf: cpfRpc,
          matricula,
          raw_data: rawData,
        },
        {
          users: weakUsers,
          matchRpc: async (args) =>
            restRpc<unknown>(cfg, 'rep_match_user_id_for_rep_punch_row', args as Record<string, unknown>),
        }
      );

      if (identity.userId) {
        forceUserId = identity.userId;
        rawData = applyResolvedIdentityToRaw(rawData, identity.userId);
        if (identity.source === 'weak' && identity.canonicalPis) {
          pisRpc = identity.canonicalPis;
          cpfRpc = identity.canonicalPis;
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
            globalThis.console.warn('[REP AUTO FIX] pis corrigido via fallback', { userId: identity.userId });
          }
        }
      } else {
        rawData = applyUnresolvedIdentityToRaw(rawData);
      }

      let rpcResult: Record<string, unknown> = {};
      try {
        const rawRpc = await restRpc<unknown>(cfg, 'rep_ingest_punch', {
          p_company_id: ev.company_id,
          p_rep_device_id: repDeviceId,
          p_pis: pisRpc,
          p_cpf: cpfRpc,
          p_matricula: matricula,
          p_nome_funcionario: null,
          p_data_hora: ev.occurred_at,
          p_tipo_marcacao: tipo,
          p_nsr: nsr,
          p_raw_data: rawData,
          p_only_staging: false,
          p_apply_schedule: false,
          p_force_user_id: forceUserId,
          p_trust_client_identity: true,
        });
        rpcResult = unwrapRpcResult(rawRpc);
      } catch {
        out.errors += 1;
        await markPromoted(cfg, table, ev.id, {
          promote_error: 'rpc_exception',
        });
        out.processed += 1;
        continue;
      }

      const duplicate = rpcResult.duplicate === true;
      const userNotFound = rpcResult.user_not_found === true;
      const success = rpcResult.success === true;
      const timeRecordId = typeof rpcResult.time_record_id === 'string' ? rpcResult.time_record_id : null;

      if (!duplicate && typeof globalThis !== 'undefined' && globalThis.console) {
        const status = forceUserId ? 'resolved' : 'unresolved';
        globalThis.console.warn('[REP INGEST]', {
          nsr,
          resolved_user_id: forceUserId,
          status,
        });
      }

      if (duplicate) {
        out.duplicate += 1;
        await markPromoted(cfg, table, ev.id, { promote_error: 'duplicate_rep' });
      } else if (success && timeRecordId) {
        out.timeRecords += 1;
        await markPromoted(cfg, table, ev.id, {
          time_record_id: timeRecordId,
          promote_error: null,
        });
      } else if (userNotFound) {
        out.userNotFound += 1;
        await markPromoted(cfg, table, ev.id, { promote_error: 'user_not_found' });
      } else if (success && !timeRecordId) {
        out.userNotFound += 1;
        await markPromoted(cfg, table, ev.id, { promote_error: 'no_time_record' });
      } else {
        out.errors += 1;
        const errMsg =
          typeof rpcResult.error === 'string' ? rpcResult.error : JSON.stringify(rpcResult).slice(0, 200);
        await markPromoted(cfg, table, ev.id, {
          promote_error: errMsg || 'rpc_failed',
        });
      }
      out.processed += 1;
    }
  }

  return out;
}

async function markPromoted(
  cfg: SupabaseRestConfig,
  table: string,
  id: string,
  fields: { time_record_id?: string | null; promote_error?: string | null }
): Promise<void> {
  const body: Record<string, unknown> = {
    promoted_at: new Date().toISOString(),
    ...fields,
  };
  await restPatch(cfg, `${table}?id=eq.${encodeURIComponent(id)}`, body);
}
