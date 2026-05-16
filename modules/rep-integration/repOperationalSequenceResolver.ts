/**
 * Reconciliação operacional do dia (REP + espelho) — análise em TypeScript.
 * O espelho continua protegido pelo trigger SQL; aqui apenas timeline, gaps e telemetria.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { replaceOperationalAlertsForDay } from '../alerts/operationalAlertsEngine';

export type OperationalSequenceResolution =
  | 'promote_normally'
  | 'recover_missing_clock_out'
  | 'recover_missing_interval'
  | 'merge_duplicate_entry'
  | 'keep_pending';

export type OperationalIncidentKind =
  | 'sequence_gap'
  | 'overlap'
  | 'duplicate_entry'
  | 'orphan_exit'
  | 'orphan_pause';

export type OperationalIncident = {
  kind: OperationalIncidentKind;
  message: string;
  /** ISO instant */
  at?: string;
  repPunchLogId?: string;
};

export type OperationalTimelineEvent = {
  kind: 'mirror' | 'rep_pending';
  instantMs: number;
  /** ISO string preserved for logs */
  instantIso: string;
  typeNorm: 'entrada' | 'saida' | 'pausa';
  id?: string;
};

export type OperationalDayReconciliation = {
  employeeId: string;
  date: string;
  orderedEvents: OperationalTimelineEvent[];
  issues: OperationalIncident[];
  counts: { mirror: number; pendingRep: number };
  /** Por rep_punch_log id: leitura operacional para pré-voo (não substitui o trigger). */
  resolutionByRepId: Record<string, OperationalSequenceResolution>;
};

/** Mesmos valores persistidos em `operational_day_status.status`. */
export type OperationalDayUiStatus = 'ok' | 'incomplete' | 'inconsistent' | 'pending_rep' | 'error';

/**
 * Prioridade alinhada ao produto: error → inconsistent → incomplete → pending_rep → ok.
 * `extraErrors` cobre falhas de leitura/persistência fora da reconciliação pura.
 */
export function deriveOperationalDayUiStatus(
  result: OperationalDayReconciliation,
  repPendingCount: number,
  extraErrors: readonly string[] = [],
): OperationalDayUiStatus {
  const errors = extraErrors.filter((s) => String(s).trim().length > 0);
  const kinds = new Set(result.issues.map((i) => i.kind));
  const hasInconsistency =
    kinds.has('overlap') ||
    kinds.has('duplicate_entry') ||
    kinds.has('orphan_exit') ||
    kinds.has('orphan_pause');
  const hasGaps = kinds.has('sequence_gap');

  if (errors.length > 0) return 'error';
  if (hasInconsistency) return 'inconsistent';
  if (hasGaps) return 'incomplete';
  if (repPendingCount > 0) return 'pending_rep';
  return 'ok';
}

function firstLastPunchFromMirrorRecords(
  rows: Array<{ timestamp: string }>,
): { first: string | null; last: string | null } {
  const sorted = rows
    .map((r) => ({ iso: r.timestamp, t: Date.parse(r.timestamp) }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return { first: null, last: null };
  return { first: sorted[0].iso, last: sorted[sorted.length - 1].iso };
}

/** Leitura espelho + REP pendente, reconciliação TS e RPC `upsert_operational_day_status`. */
export async function fetchReconcileAndUpsertOperationalDayStatus(
  supabase: SupabaseClient,
  companyId: string,
  employeeId: string,
  dateYmd: string,
  extraErrors: readonly string[] = [],
): Promise<OperationalDayReconciliation | null> {
  const company = companyId.trim();
  const emp = employeeId.trim();
  const day = dateYmd.trim();
  if (!company || !emp || !day) return null;

  const runUpsert = async (input: {
    status: OperationalDayUiStatus;
    totalRecords: number;
    totalRepPending: number;
    issues: unknown;
    firstPunch: string | null;
    lastPunch: string | null;
  }): Promise<boolean> => {
    const { error } = await supabase.rpc('upsert_operational_day_status', {
      p_company_id: company,
      p_employee_id: emp,
      p_date: day,
      p_status: input.status,
      p_total_records: input.totalRecords,
      p_total_rep_pending: input.totalRepPending,
      p_issues: input.issues,
      p_first_punch: input.firstPunch,
      p_last_punch: input.lastPunch,
    });
    if (error) {
      console.error('[OPERATIONAL STATUS UPSERT FAILED]', {
        companyId: company,
        employeeId: emp,
        date: day,
        status: input.status,
        message: error.message,
      });
      return false;
    }
    console.log('[OPERATIONAL STATUS UPDATED]', {
      companyId: company,
      employeeId: emp,
      date: day,
      status: input.status,
    });
    return true;
  };

  try {
    const { startIso, endIso } = saoPauloCivilBoundsUtc(day);
    const { data: trs, error: e1 } = await supabase
      .from('time_records')
      .select('id,timestamp,type')
      .eq('company_id', company)
      .eq('user_id', emp)
      .gte('timestamp', startIso)
      .lte('timestamp', endIso)
      .limit(800);
    if (e1) {
      await runUpsert({
        status: 'error',
        totalRecords: 0,
        totalRepPending: 0,
        issues: [{ scope: 'time_records', message: e1.message }],
        firstPunch: null,
        lastPunch: null,
      });
      return null;
    }

    const { data: pend, error: e2 } = await supabase
      .from('rep_punch_logs')
      .select('id,data_hora,tipo_marcacao')
      .eq('company_id', company)
      .eq('resolved_user_id', emp)
      .is('time_record_id', null)
      .eq('ignored', false)
      .gte('data_hora', startIso)
      .lte('data_hora', endIso)
      .limit(800);
    if (e2) {
      await runUpsert({
        status: 'error',
        totalRecords: trs?.length ?? 0,
        totalRepPending: 0,
        issues: [{ scope: 'rep_punch_logs', message: e2.message }],
        firstPunch: null,
        lastPunch: null,
      });
      return null;
    }

    const mirrorRows = trs ?? [];
    const pendingRows = pend ?? [];
    const rec = reconcileOperationalDaySequence({
      employeeId: emp,
      date: day,
      timeRecords: mirrorRows.map((r) => ({
        id: r.id as string,
        timestamp: r.timestamp as string,
        type: r.type as string,
      })),
      pendingRepPunches: pendingRows.map((r) => ({
        id: r.id as string,
        data_hora: r.data_hora as string,
        tipo_marcacao: (r.tipo_marcacao as string | null) ?? null,
      })),
    });

    const repPendingCount = pendingRows.length;
    const { first, last } = firstLastPunchFromMirrorRecords(
      mirrorRows.map((r) => ({ timestamp: r.timestamp as string })),
    );

    const status = deriveOperationalDayUiStatus(rec, repPendingCount, extraErrors);
    const issuesPayload = rec.issues.length > 0 ? rec.issues : [];

    const statusOk = await runUpsert({
      status,
      totalRecords: mirrorRows.length,
      totalRepPending: repPendingCount,
      issues: issuesPayload,
      firstPunch: first,
      lastPunch: last,
    });

    if (statusOk) {
      await replaceOperationalAlertsForDay(
        supabase,
        company,
        emp,
        day,
        mirrorRows.map((r) => ({
          timestamp: r.timestamp as string,
          type: r.type as string,
        })),
        pendingRows.map((r) => ({
          data_hora: r.data_hora as string,
          tipo_marcacao: (r.tipo_marcacao as string | null) ?? null,
        })),
        status,
      );
    }

    return rec;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await runUpsert({
      status: 'error',
      totalRecords: 0,
      totalRepPending: 0,
      issues: [{ scope: 'reconcile', message: msg }],
      firstPunch: null,
      lastPunch: null,
    });
    return null;
  }
}

/** Meia-noite a fim do dia em America/Sao_Paulo como UTC (offset fixo −3, sem DST). */
export function saoPauloCivilBoundsUtc(ymd: string): { startIso: string; endIso: string } {
  const parts = ymd.split('-').map((x) => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) throw new Error(`Data inválida: ${ymd}`);
  const startMs = Date.UTC(y, m - 1, d, 3, 0, 0, 0);
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

export function normalizeRepMirrorType(raw: string): 'entrada' | 'saida' | 'pausa' | 'other' {
  const t = raw.trim().toLowerCase();
  if (t === 'entrada' || t === 'e' || t === 'intervalo_volta' || t === 'b') return 'entrada';
  if (t === 'saída' || t === 'saida' || t === 's') return 'saida';
  if (t === 'pausa' || t === 'p' || t === 'intervalo_saida') return 'pausa';
  return 'other';
}

export function repTipoMarcacaoToNorm(tipo: string | null | undefined): 'entrada' | 'saida' | 'pausa' {
  const c = (tipo ?? 'E').trim().charAt(0).toUpperCase();
  if (c === 'S') return 'saida';
  if (c === 'P') return 'pausa';
  return 'entrada';
}

function compareEvents(a: OperationalTimelineEvent, b: OperationalTimelineEvent): number {
  if (a.instantMs !== b.instantMs) return a.instantMs - b.instantMs;
  if (a.kind !== b.kind) return a.kind === 'mirror' ? -1 : 1;
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

/**
 * Monta a linha do tempo operacional, deteta gaps / sobreposições / entradas duplicadas / saídas órfãs.
 * Não altera dados nem o motor de cálculo.
 */
export function reconcileOperationalDaySequence(input: {
  employeeId: string;
  date: string;
  /** Registos já no espelho (time_records) — usar timestamp + type. */
  timeRecords: Array<{ id?: string; timestamp: string; type: string }>;
  /** Linhas REP pendentes (time_record_id nulo) com data_hora + tipo_marcacao. */
  pendingRepPunches: Array<{ id: string; data_hora: string; tipo_marcacao: string | null }>;
}): OperationalDayReconciliation {
  const orderedEvents: OperationalTimelineEvent[] = [];
  for (const tr of input.timeRecords) {
    const tn = normalizeRepMirrorType(tr.type);
    if (tn === 'other') continue;
    const t = Date.parse(tr.timestamp);
    if (Number.isNaN(t)) continue;
    orderedEvents.push({
      kind: 'mirror',
      instantMs: t,
      instantIso: tr.timestamp,
      typeNorm: tn,
      id: tr.id,
    });
  }
  for (const p of input.pendingRepPunches) {
    const tn = repTipoMarcacaoToNorm(p.tipo_marcacao);
    const t = Date.parse(p.data_hora);
    if (Number.isNaN(t)) continue;
    orderedEvents.push({
      kind: 'rep_pending',
      instantMs: t,
      instantIso: p.data_hora,
      typeNorm: tn,
      id: p.id,
    });
  }
  orderedEvents.sort(compareEvents);

  const issues: OperationalIncident[] = [];
  let last: OperationalTimelineEvent | null = null;

  for (const ev of orderedEvents) {
    if (last && ev.instantMs === last.instantMs && last.typeNorm === ev.typeNorm) {
      issues.push({
        kind: 'overlap',
        message: 'Dois eventos no mesmo instante com o mesmo tipo operacional.',
        at: ev.instantIso,
        repPunchLogId: ev.kind === 'rep_pending' ? ev.id : undefined,
      });
    }

    if (!last) {
      if (ev.typeNorm === 'saida') {
        issues.push({
          kind: 'orphan_exit',
          message: 'Saída sem entrada prévia no dia (sequência operacional).',
          at: ev.instantIso,
          repPunchLogId: ev.kind === 'rep_pending' ? ev.id : undefined,
        });
      } else if (ev.typeNorm === 'pausa') {
        issues.push({
          kind: 'orphan_pause',
          message: 'Início de intervalo sem entrada prévia no dia.',
          at: ev.instantIso,
          repPunchLogId: ev.kind === 'rep_pending' ? ev.id : undefined,
        });
      }
      last = ev;
      continue;
    }

    const prevType = last.typeNorm;
    const cur = ev.typeNorm;

    if (prevType === 'entrada' && cur === 'entrada') {
      issues.push({
        kind: 'duplicate_entry',
        message: 'Entrada duplicada: falta saída ou intervalo antes da nova entrada.',
        at: ev.instantIso,
        repPunchLogId: ev.kind === 'rep_pending' ? ev.id : undefined,
      });
      issues.push({
        kind: 'sequence_gap',
        message: 'Possível saída em falta antes da próxima entrada.',
        at: last.instantIso,
      });
    }

    if (prevType === 'pausa' && cur === 'pausa') {
      issues.push({
        kind: 'sequence_gap',
        message: 'Intervalo já aberto; nova pausa sem retorno.',
        at: ev.instantIso,
        repPunchLogId: ev.kind === 'rep_pending' ? ev.id : undefined,
      });
    }

    if (prevType === 'pausa' && cur === 'saida') {
      issues.push({
        kind: 'sequence_gap',
        message: 'Saída final com intervalo ainda aberto (falta retorno).',
        at: ev.instantIso,
        repPunchLogId: ev.kind === 'rep_pending' ? ev.id : undefined,
      });
    }

    if (prevType === 'saida' && cur === 'saida') {
      issues.push({
        kind: 'sequence_gap',
        message: 'Saída duplicada: falta entrada antes da nova saída.',
        at: ev.instantIso,
        repPunchLogId: ev.kind === 'rep_pending' ? ev.id : undefined,
      });
    }

    if (prevType === 'saida' && cur === 'pausa') {
      issues.push({
        kind: 'sequence_gap',
        message: 'Intervalo após saída final — entrada esperada antes.',
        at: ev.instantIso,
        repPunchLogId: ev.kind === 'rep_pending' ? ev.id : undefined,
      });
    }

    last = ev;
  }

  const resolutionByRepId: Record<string, OperationalSequenceResolution> = {};
  for (const ev of orderedEvents) {
    if (ev.kind !== 'rep_pending' || !ev.id) continue;
    const relIssues = issues.filter((i) => i.repPunchLogId === ev.id);
    if (relIssues.some((i) => i.kind === 'duplicate_entry')) {
      resolutionByRepId[ev.id] = 'keep_pending';
      continue;
    }
    if (relIssues.some((i) => i.kind === 'orphan_exit' || i.kind === 'orphan_pause')) {
      resolutionByRepId[ev.id] = 'keep_pending';
      continue;
    }
    if (relIssues.some((i) => i.kind === 'sequence_gap')) {
      const onlyGap = relIssues.every((i) => i.kind === 'sequence_gap');
      resolutionByRepId[ev.id] = onlyGap ? 'recover_missing_clock_out' : 'keep_pending';
      continue;
    }
    resolutionByRepId[ev.id] = 'promote_normally';
  }

  return {
    employeeId: input.employeeId,
    date: input.date,
    orderedEvents,
    issues,
    counts: {
      mirror: input.timeRecords.length,
      pendingRep: input.pendingRepPunches.length,
    },
    resolutionByRepId,
  };
}

export function classifyRepPendingResolution(
  reconciliation: OperationalDayReconciliation,
  repPunchLogId: string,
): OperationalSequenceResolution {
  return reconciliation.resolutionByRepId[repPunchLogId] ?? 'keep_pending';
}
