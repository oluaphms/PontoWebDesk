/**
 * Sugestões assistidas na auditoria de jornada — puras onde possível; fetch de padrão fica à parte.
 */

import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import {
  calendarDateForEspelhoRow,
  localCalendarDayEndUtc,
  localCalendarDayStartUtc,
} from '../utils/calendarUtils';
import { recordPunchInstantMs } from '../utils/punchOrigin';
import { hasValidClockWindow, type TimeAttendanceRow } from './timeAttendanceData';
import type { WorkScheduleInfo } from './timeProcessingService';
import { getDayRecords, summarizeDayRecords } from './timeProcessingService';

export type AuditSuggestion =
  | { type: 'suggest_clock_out'; time: string; basis: 'schedule' | 'pattern' }
  | { type: 'suggest_remove_group'; groupIndex: number }
  | { type: 'none' };

function hhmmToMinutes(h: string): number {
  const [hh, mm] = String(h || '00:00').slice(0, 5).split(':').map((x) => parseInt(x, 10));
  return (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
}

function minutesToHhmm(m: number): string {
  const total = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = Math.round(total % 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Mediana de horários de saída (HH:mm) — exige amostras suficientes para confiança razoável. */
export function inferMedianOutTimeFromSamples(samples: Array<{ saida: string | null }>): string | null {
  const mins = samples
    .map((s) => s.saida)
    .filter((s): s is string => Boolean(s && String(s).trim()))
    .map((s) => hhmmToMinutes(s.slice(0, 5)));
  if (mins.length < 3) return null;
  mins.sort((a, b) => a - b);
  return minutesToHhmm(mins[Math.floor(mins.length / 2)]!);
}

/** Agrupa batidas por lacuna mínima (minutos) entre instantes consecutivos. */
export function groupDayRecordsByGapMinutes(
  records: Record<string, unknown>[],
  gapMinutes: number,
): Record<string, unknown>[][] {
  if (records.length === 0) return [];
  const gapMs = Math.max(1, gapMinutes) * 60 * 1000;
  const sorted = [...records].sort(
    (a, b) => recordPunchInstantMs(a as never) - recordPunchInstantMs(b as never),
  );
  const groups: Record<string, unknown>[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const dt = recordPunchInstantMs(cur as never) - recordPunchInstantMs(prev as never);
    if (dt > gapMs) groups.push([]);
    groups[groups.length - 1]!.push(cur);
  }
  return groups;
}

function indexOfSmallestGroup(groups: Record<string, unknown>[][]): number {
  let minIdx = 0;
  let minLen = Infinity;
  for (let i = 0; i < groups.length; i++) {
    const len = groups[i]!.length;
    if (len < minLen) {
      minLen = len;
      minIdx = i;
    }
  }
  return minIdx;
}

/**
 * Função pura: não faz I/O. `patternOutTime` e `userSchedule` vêm de carregamento externo.
 */
export function getAuditSuggestion(
  row: TimeAttendanceRow,
  dayRecords: Record<string, unknown>[],
  opts?: {
    userSchedule?: WorkScheduleInfo | null;
    patternOutTime?: string | null;
    duplicateGroupGapMinutes?: number;
  },
): AuditSuggestion {
  const gapMin = opts?.duplicateGroupGapMinutes ?? 120;

  if (
    row.status_label === 'inconsistent_data' &&
    row.clock_in &&
    !row.clock_out
  ) {
    const scheduledOut = opts?.userSchedule?.end_time
      ? String(opts.userSchedule.end_time).trim().slice(0, 5)
      : '';
    if (scheduledOut && /^\d{2}:\d{2}$/.test(scheduledOut)) {
      return { type: 'suggest_clock_out', time: scheduledOut, basis: 'schedule' };
    }
    const pattern = opts?.patternOutTime ? String(opts.patternOutTime).trim().slice(0, 5) : '';
    if (pattern && /^\d{2}:\d{2}$/.test(pattern)) {
      return { type: 'suggest_clock_out', time: pattern, basis: 'pattern' };
    }
  }

  if (row.status_label === 'duplicate_user_day' && dayRecords.length > 0) {
    const groups = groupDayRecordsByGapMinutes(dayRecords, gapMin);
    if (groups.length > 1) {
      return { type: 'suggest_remove_group', groupIndex: indexOfSmallestGroup(groups) };
    }
  }

  return { type: 'none' };
}

export function suggestionTooltip(s: AuditSuggestion): string | undefined {
  if (s.type === 'suggest_clock_out' && s.basis === 'schedule') {
    return 'Base: horário de saída do turno cadastrado (jornada padrão).';
  }
  if (s.type === 'suggest_clock_out' && s.basis === 'pattern') {
    return 'Base: mediana das saídas nos últimos dias com espelho completo (mín. 3 amostras).';
  }
  if (s.type === 'suggest_remove_group') {
    return 'Abre o conjunto de batidas menor para revisão manual. Não remove registros automaticamente.';
  }
  return undefined;
}

export function suggestionShortLabel(s: AuditSuggestion): string | null {
  if (s.type === 'suggest_clock_out') {
    const src = s.basis === 'schedule' ? 'horário padrão' : 'padrão recente';
    return `Sugerir saída às ${s.time} (${src})`;
  }
  if (s.type === 'suggest_remove_group') {
    return 'Sugerir revisar conjunto menor de batidas';
  }
  return null;
}

/** Bloqueia aplicação automática (ou abertura segura) com mensagem humana. */
export function blockReasonForAuditSuggestion(
  row: TimeAttendanceRow,
  suggestion: AuditSuggestion,
  userRole: string | undefined,
): string | null {
  if (userRole !== 'admin' && userRole !== 'hr') {
    return 'Apenas administrador ou RH pode aplicar sugestões.';
  }
  if (row.status_label === 'closed_period') return 'Período fechado.';
  if (row.status_label === 'protected_timesheet') return 'Espelho protegido.';

  if (suggestion.type === 'suggest_clock_out') {
    if (!row.clock_in) return 'Sem entrada registrada para ancorar a saída.';
    if (row.clock_out) return 'Já existe saída neste dia.';
    const tin = String(row.clock_in).slice(0, 5);
    const tout = suggestion.time.slice(0, 5);
    if (!hasValidClockWindow(tin, tout)) {
      return 'Janela de batidas inválida para recálculo (saída deve ser após a entrada).';
    }
  }

  return null;
}

/** Últimos 7 dias civis anteriores à data âncora: mediana das saídas quando o dia teve par entrada/saída. */
export async function fetchRecentSaidaPatternForAudit(
  employeeId: string,
  companyId: string,
  anchorDateYmd: string,
): Promise<string | null> {
  if (!isSupabaseConfigured() || !employeeId || !companyId) return null;
  const anchor = new Date(`${anchorDateYmd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(anchor.getTime())) return null;

  const samples: Array<{ saida: string | null }> = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(anchor);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const ymd = `${y}-${m}-${day}`;
    try {
      const records = await getDayRecords(employeeId, ymd);
      const sum = summarizeDayRecords(records);
      if (sum.entrada && sum.saida) samples.push({ saida: sum.saida });
    } catch {
      /* ignora dia com falha */
    }
  }
  return inferMedianOutTimeFromSamples(samples);
}

/** Mapa `user_id|YYYY-MM-DD` → lista de batidas no período (alinhado ao espelho). */
export async function fetchPunchesMapForAuditPeriod(
  companyId: string,
  startYmd: string,
  endYmd: string,
): Promise<Map<string, Record<string, unknown>[]>> {
  const map = new Map<string, Record<string, unknown>[]>();
  if (!isSupabaseConfigured() || !companyId) return map;
  const safeStart = String(startYmd).slice(0, 10);
  const safeEnd = String(endYmd).slice(0, 10);
  if (safeStart > safeEnd) return map;

  let recordRows: Record<string, unknown>[] = [];
  try {
    recordRows = await db.select(
      'time_records',
      [
        { column: 'company_id', operator: 'eq', value: companyId },
        { column: 'created_at', operator: 'gte', value: localCalendarDayStartUtc(safeStart) },
        { column: 'created_at', operator: 'lte', value: localCalendarDayEndUtc(safeEnd) },
      ],
      {
        columns: 'id,user_id,company_id,type,created_at,timestamp,origin,source,method,nsr',
        orderBy: { column: 'created_at', ascending: true },
        limit: 50000,
      },
    );
  } catch {
    return map;
  }

  for (const r of recordRows ?? []) {
    const uid = typeof r.user_id === 'string' ? r.user_id : '';
    if (!uid) continue;
    const day = calendarDateForEspelhoRow(
      r as { timestamp?: string | null; created_at: string },
      safeStart,
      safeEnd,
    );
    if (day < safeStart || day > safeEnd) continue;
    const key = `${uid}|${day}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}
