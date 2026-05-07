/**
 * Reconciliação operacional do dia (REP + espelho) — análise em TypeScript.
 * O espelho continua protegido pelo trigger SQL; aqui apenas timeline, gaps e telemetria.
 */

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
