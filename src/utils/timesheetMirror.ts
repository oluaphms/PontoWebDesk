import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Utilitários para construir o espelho de ponto (timesheet mirror)
 * Processa time_records e organiza por dia/funcionário
 */

import { localCalendarYmd } from './localDateTimeToIso';
import { calendarDateForEspelhoRow, extractLocalCalendarDateFromIso } from './calendarUtils';
import { isDevVerboseLogsEnabled } from './devVerboseLogs';
import { isColaboradorSelfServicePunch, isRhAdjustmentOrigin, resolvePunchOrigin } from './punchOrigin';

export { calendarDateForEspelhoRow, extractLocalCalendarDateFromIso } from './calendarUtils';

export interface TimeRecord {
  id: string;
  user_id: string;
  created_at: string;
  timestamp?: string | null;
  /** Valores vindos do DB podem usar acentuação (`saída`) ou sinônimos (`pausa`, `batida`). */
  type: 'entrada' | 'saida' | 'intervalo_saida' | 'intervalo_volta' | string;
  manual_reason?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_manual?: boolean;
  adjusted?: boolean;
  /** Origem da batida no `time_records` (ex.: `rep` = relógio). */
  source?: string | null;
  method?: string | null;
  /** Migração: `rep` | `mobile` | `admin` — reforço semântico além de `source`. */
  origin?: string | null;
  source_type?: string | null;
  metadata?: unknown;
  raw_data?: unknown;
  nsr?: number | string | null;
}

/** Batida vinda do REP / relógio (origem para rótulo e auditoria — não altera slot no espelho). */
export function isRepMirrorRecord(record: TimeRecord): boolean {
  if (record.nsr != null && String(record.nsr).trim() !== '') return true;
  const o = String(record.origin ?? '')
    .trim()
    .toLowerCase();
  if (o === 'rep') return true;
  const s = String(record.source ?? '')
    .trim()
    .toLowerCase();
  const m = String(record.method ?? '')
    .trim()
    .toLowerCase();
  return s === 'rep' || m === 'rep' || s === 'clock';
}

/** Tipo canônico para o espelho (REP/interpretação usam grafias diferentes). */
export type NormalizedMirrorRecordType =
  | 'entrada'
  | 'saida'
  | 'intervalo_saida'
  | 'intervalo_volta'
  | 'unknown';

/**
 * Normaliza `type` do `time_records` para o fluxo entrada → intervalo → volta → saída.
 * O PostgreSQL grava `saída` (com acento); o app legado usa `saida`.
 */
export function normalizeRecordTypeForMirror(raw: string | null | undefined): NormalizedMirrorRecordType {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (t === 'entrada') return 'entrada';
  if (t === 'saida') return 'saida';
  if (t === 'intervalo_saida') return 'intervalo_saida';
  if (t === 'intervalo_volta') return 'intervalo_volta';
  if (t === 'pausa') return 'intervalo_saida';
  return 'unknown';
}

/** Instante da batida para ordenação/exibição: horário oficial da batida antes do metadado de inserção. */
export function recordMirrorInstant(record: TimeRecord): string {
  const ts = record.timestamp;
  const ca = record.created_at;
  if (ts && String(ts).trim()) return ts;
  if (ca && String(ca).trim()) return ca;
  return new Date().toISOString();
}

/**
 * Instantâneo usado para horas no dia `dayDateStr` da grelha: alinha com `calendarDateForEspelhoRow`.
 */
export function recordEffectiveMirrorInstant(record: TimeRecord, dayDateStr: string): string {
  const instant = recordIso(record);
  if (extractLocalCalendarDateFromIso(instant) === dayDateStr) return instant;
  if (extractLocalCalendarDateFromIso(record.created_at) === dayDateStr) {
    return record.created_at;
  }
  return instant;
}

/** Slots da grelha do espelho (ordem operacional 1…4). */
export type MirrorGridSlot = 'entrada' | 'saida_intervalo' | 'volta_intervalo' | 'saida_final';

/** Eventos de auditoria da consolidação (produção / testes). */
export type MirrorConsolidationAuditKind =
  | 'TIME RECORD SLOT ASSIGNED'
  | 'TIME RECORD DUPLICATE SLOT BLOCKED'
  | 'TIME RECORD CHRONOLOGY VIOLATION'
  | 'TIME RECORD ENTRY OVERWRITE BLOCKED';

export interface MirrorConsolidationAuditEntry {
  kind: MirrorConsolidationAuditKind;
  record_id?: string;
  source?: string | null;
  timestamp?: string;
  assigned_slot?: MirrorGridSlot;
  detail?: string;
}

export interface DayMirror {
  date: string;
  entradaInicio: string | null;
  saidaIntervalo: string | null;
  voltaIntervalo: string | null;
  saidaFinal: string | null;
  workedMinutes: number;
  records: TimeRecord[];
  batidasExtra: TimeRecord[];
  inconsistencias: TimeRecord[];
  /** Batida → coluna (1:1), para UI/PDF sem heurística REP>APP. */
  slotRecordIds?: Partial<Record<MirrorGridSlot, string>>;
  /** Trilha opcional da consolidação (espelho). */
  mirrorAudit?: MirrorConsolidationAuditEntry[];
  /** Opcional: sinaliza atraso/falta quando preenchido pelo espelho/PDF */
  isLate?: boolean;
  isMissing?: boolean;
}

/** Janela da escala no dia (entrada/saída esperadas) — opcional para status “extra” só fora da janela. */
export interface DayScheduleWindow {
  entrada: string;
  saida: string;
  toleranceMin?: number;
}

export interface DayScheduleSlots {
  entrada: string;
  saida_intervalo: string;
  volta_intervalo: string;
  saida_final: string;
  toleranceMin?: number;
}

const DEFAULT_MIRROR_TOLERANCE_MINUTES = 60;

const GRID_SLOTS: readonly MirrorGridSlot[] = [
  'entrada',
  'saida_intervalo',
  'volta_intervalo',
  'saida_final',
] as const;

function parseHHmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function emitMirrorAudit(
  audit: MirrorConsolidationAuditEntry[] | undefined,
  entry: MirrorConsolidationAuditEntry,
): void {
  audit?.push(entry);
  if (import.meta.env.MODE === 'test') return;
  if (!isDevVerboseLogsEnabled()) return;
  if (typeof globalThis !== 'undefined' && globalThis.console) {
    observabilityConsole.warn(`[${entry.kind}]`, {
      record_id: entry.record_id,
      source: entry.source,
      timestamp: entry.timestamp,
      assigned_slot: entry.assigned_slot,
      detail: entry.detail,
    });
  }
}

function scheduleExpectedMinute(slot: MirrorGridSlot, schedule: DayScheduleSlots): number | null {
  switch (slot) {
    case 'entrada':
      return parseHHmmToMinutes(schedule.entrada);
    case 'saida_intervalo':
      return parseHHmmToMinutes(schedule.saida_intervalo);
    case 'volta_intervalo':
      return parseHHmmToMinutes(schedule.volta_intervalo);
    case 'saida_final':
      return parseHHmmToMinutes(schedule.saida_final);
    default:
      return null;
  }
}

/**
 * Motor principal do espelho: 1ª batida cronológica → Entrada, 2ª → Saída int., 3ª → Volta int., 4ª → Saída.
 * Cada `record_id` ocupa no máximo uma coluna; `source` não altera a posição.
 */
function consolidateMirrorGridStrictChronology(
  sorted: TimeRecord[],
  dayDateStr: string,
  schedule: DayScheduleSlots | null | undefined,
  audit?: MirrorConsolidationAuditEntry[],
): {
  entradaInicio: string | null;
  saidaIntervalo: string | null;
  voltaIntervalo: string | null;
  saidaFinal: string | null;
  slotRecordIds: Partial<Record<MirrorGridSlot, string>>;
  batidasExtra: TimeRecord[];
  inconsistencias: TimeRecord[];
} {
  const slotRecordIds: Partial<Record<MirrorGridSlot, string>> = {};
  const times: Record<MirrorGridSlot, string | null> = {
    entrada: null,
    saida_intervalo: null,
    volta_intervalo: null,
    saida_final: null,
  };
  const gridAssignedIds = new Set<string>();
  const blockedDuplicateIds = new Set<string>();
  const inconsistencias: TimeRecord[] = [];
  const tolerance = schedule?.toleranceMin ?? DEFAULT_MIRROR_TOLERANCE_MINUTES;

  let slotIdx = 0;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    const prev = sorted[i - 1];
    if (prev) {
      const tPrev = new Date(recordEffectiveMirrorInstant(prev, dayDateStr)).getTime();
      const tCur = new Date(recordEffectiveMirrorInstant(r, dayDateStr)).getTime();
      if (tCur < tPrev) {
        emitMirrorAudit(audit, {
          kind: 'TIME RECORD CHRONOLOGY VIOLATION',
          record_id: r.id,
          source: r.source ?? null,
          timestamp: recordEffectiveMirrorInstant(r, dayDateStr),
          detail: 'timestamp anterior à batida precedente após ordenação',
        });
      }
    }

    if (gridAssignedIds.has(r.id)) {
      emitMirrorAudit(audit, {
        kind: 'TIME RECORD DUPLICATE SLOT BLOCKED',
        record_id: r.id,
        source: r.source ?? null,
        timestamp: recordEffectiveMirrorInstant(r, dayDateStr),
        detail: 'record_id já utilizado na grelha',
      });
      blockedDuplicateIds.add(r.id);
      continue;
    }

    if (slotIdx >= GRID_SLOTS.length) {
      continue;
    }

    const slot = GRID_SLOTS[slotIdx]!;
    slotIdx += 1;

    const effIso = recordEffectiveMirrorInstant(r, dayDateStr);
    const hhmm = extractTime(effIso);
    times[slot] = hhmm;
    slotRecordIds[slot] = r.id;
    gridAssignedIds.add(r.id);

    emitMirrorAudit(audit, {
      kind: 'TIME RECORD SLOT ASSIGNED',
      record_id: r.id,
      source: r.source ?? null,
      timestamp: effIso,
      assigned_slot: slot,
    });

    if (schedule) {
      const exp = scheduleExpectedMinute(slot, schedule);
      const punchMin = parseHHmmToMinutes(hhmm);
      if (exp != null && punchMin != null && Math.abs(punchMin - exp) > tolerance) {
        inconsistencias.push(r);
      }
    }
  }

  const batidasExtra = sorted.filter((r) => !gridAssignedIds.has(r.id) && !blockedDuplicateIds.has(r.id));

  const entradaSlotId = slotRecordIds.entrada;
  if (entradaSlotId) {
    for (const r of sorted) {
      if (normalizeRecordTypeForMirror(r.type) !== 'entrada') continue;
      if (r.id === entradaSlotId) continue;
      emitMirrorAudit(audit, {
        kind: 'TIME RECORD ENTRY OVERWRITE BLOCKED',
        record_id: r.id,
        source: r.source ?? null,
        timestamp: recordEffectiveMirrorInstant(r, dayDateStr),
        detail: 'entrada tipificada não substitui a 1ª batida cronológica na coluna Entrada',
      });
    }
  }

  return {
    entradaInicio: times.entrada,
    saidaIntervalo: times.saida_intervalo,
    voltaIntervalo: times.volta_intervalo,
    saidaFinal: times.saida_final,
    slotRecordIds,
    batidasExtra,
    inconsistencias,
  };
}

const STATUS_TAG_REGEX = /\[STATUS:(FOLGA|FALTA|EXTRA)\]/i;

export function isStatusRecord(record: TimeRecord): boolean {
  return STATUS_TAG_REGEX.test(String(record.manual_reason || ''));
}

export function getStatusOverride(day: DayMirror): 'folga' | 'falta' | 'extra' | null {
  const match = day.records
    .map((r) => String(r.manual_reason || ''))
    .map((reason) => reason.match(STATUS_TAG_REGEX))
    .find(Boolean);
  if (!match) return null;
  const key = match[1].toLowerCase();
  if (key === 'folga' || key === 'falta' || key === 'extra') return key;
  return null;
}

/**
 * Extrai apenas a hora (HH:mm) de uma data ISO
 */
function extractTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function recordIso(record: TimeRecord): string {
  return recordMirrorInstant(record);
}

/**
 * Verifica se um registro é manual (tem manual_reason ou is_manual=true)
 */
export function isManualRecord(record: TimeRecord): boolean {
  if (STATUS_TAG_REGEX.test(String(record.manual_reason || ''))) return true;
  const kind = resolvePunchOrigin(record).kind;
  if (kind === 'admin') return true;
  if (kind === 'mobile' || kind === 'web' || kind === 'rep' || kind === 'afd') return false;
  return !!(record.manual_reason && record.manual_reason.trim()) || record.is_manual === true;
}

/** Admin/RH podem editar somente batidas lançadas manualmente pelo espelho. */
export function isEditableManualMirrorRecord(record: TimeRecord): boolean {
  if (isRepMirrorRecord(record)) return false;
  if (isColaboradorSelfServicePunch(record)) return false;
  return isRhAdjustmentOrigin(record);
}

/**
 * Ordena registros por horário
 */
function sortRecordsByTime(records: TimeRecord[], dayDateStr: string): TimeRecord[] {
  return [...records].sort(
    (a, b) =>
      new Date(recordEffectiveMirrorInstant(a, dayDateStr)).getTime() -
      new Date(recordEffectiveMirrorInstant(b, dayDateStr)).getTime()
  );
}

/**
 * Deduplicação defensiva para colisões de batidas REP:
 * alguns fluxos podem gravar a mesma marcação (mesmo tipo/horário) mais de uma vez.
 * No espelho isso polui a sequência e pode repetir horários em colunas erradas.
 */
function dedupeRepRecordsForMirror(records: TimeRecord[], dayDateStr: string): TimeRecord[] {
  const kept = new Map<string, TimeRecord>();
  for (const r of records) {
    if (!isRepMirrorRecord(r) || isManualRecord(r)) {
      kept.set(`raw:${r.id}`, r);
      continue;
    }
    const norm = normalizeRecordTypeForMirror(r.type);
    const hhmm = extractTime(recordEffectiveMirrorInstant(r, dayDateStr));
    const key = `rep:${norm}:${hhmm}`;
    if (!kept.has(key)) {
      kept.set(key, r);
    }
  }
  return Array.from(kept.values());
}

/**
 * Ordena batidas do dia e expõe horários — útil para debug e regras por sequência (1ª…4ª).
 */
export function classifyPunch(recordsDoDia: TimeRecord[], dayDateStr: string): {
  sorted: TimeRecord[];
  times: string[];
} {
  const realRecords = recordsDoDia.filter((r) => !isStatusRecord(r));
  const sortedFirst = sortRecordsByTime(realRecords, dayDateStr);
  const sanitized = dedupeRepRecordsForMirror(sortedFirst, dayDateStr);
  const sorted = sortRecordsByTime(sanitized, dayDateStr);
  const times = sorted.map((r) => extractTime(recordEffectiveMirrorInstant(r, dayDateStr)));
  if (import.meta.env.DEV && sorted.length === 4) {
     
    observabilityConsole.log('[CLASSIFY] registros do dia:', sorted.length);
     
    observabilityConsole.log('[CLASSIFY] ordem:', times.join(', '));
     
    observabilityConsole.log('[CLASSIFY] tipos: entrada, saída_int, volta_int, saída');
  }
  return { sorted, times };
}

function buildDaySummary(records: TimeRecord[], dayDateStr: string, schedule?: DayScheduleSlots | null): DayMirror {
  const date = dayDateStr;
  const realRecords = records.filter((r) => !isStatusRecord(r));
  const sortedFirst = sortRecordsByTime(realRecords, dayDateStr);
  const sanitized = dedupeRepRecordsForMirror(sortedFirst, dayDateStr);
  const sorted = sortRecordsByTime(sanitized, dayDateStr);

  const audit: MirrorConsolidationAuditEntry[] = [];
  const grid = consolidateMirrorGridStrictChronology(sorted, dayDateStr, schedule ?? null, audit);

  let workedMinutes = 0;
  if (grid.entradaInicio && grid.saidaFinal) {
    const entrada = new Date(`${date}T${grid.entradaInicio}`);
    const saida = new Date(`${date}T${grid.saidaFinal}`);
    workedMinutes = Math.round((saida.getTime() - entrada.getTime()) / 60000);
    if (grid.saidaIntervalo && grid.voltaIntervalo) {
      const intervaloSaida = new Date(`${date}T${grid.saidaIntervalo}`);
      const intervaloVolta = new Date(`${date}T${grid.voltaIntervalo}`);
      workedMinutes -= Math.round((intervaloVolta.getTime() - intervaloSaida.getTime()) / 60000);
    }
  } else if (grid.entradaInicio && grid.saidaIntervalo && grid.voltaIntervalo && !grid.saidaFinal) {
    const entrada = new Date(`${date}T${grid.entradaInicio}`);
    const inicioIntervalo = new Date(`${date}T${grid.saidaIntervalo}`);
    const volta = new Date(`${date}T${grid.voltaIntervalo}`);
    workedMinutes = Math.round((volta.getTime() - entrada.getTime()) / 60000);
    workedMinutes -= Math.round((volta.getTime() - inicioIntervalo.getTime()) / 60000);
  } else if (grid.entradaInicio && grid.saidaIntervalo && !grid.voltaIntervalo && !grid.saidaFinal) {
    const entrada = new Date(`${date}T${grid.entradaInicio}`);
    const inicioIntervalo = new Date(`${date}T${grid.saidaIntervalo}`);
    workedMinutes = Math.round((inicioIntervalo.getTime() - entrada.getTime()) / 60000);
  }

  return {
    date,
    entradaInicio: grid.entradaInicio,
    saidaIntervalo: grid.saidaIntervalo,
    voltaIntervalo: grid.voltaIntervalo,
    saidaFinal: grid.saidaFinal,
    workedMinutes: Math.max(0, workedMinutes),
    records,
    batidasExtra: grid.batidasExtra,
    inconsistencias: grid.inconsistencias,
    slotRecordIds: grid.slotRecordIds,
    mirrorAudit: audit.length > 0 ? audit : undefined,
  };
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + delta);
  return localCalendarYmd(dt);
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function localMinutesFromIso(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Turno com entrada após saída final (ex.: 22:00 → 06:00). */
export function isNightShiftSchedule(schedule: DayScheduleSlots): boolean {
  return hhmmToMinutes(schedule.entrada) > hhmmToMinutes(schedule.saida_final);
}

/**
 * Data da linha do espelho — agrupa batidas pós-meia-noite na jornada noturna iniciada no dia anterior.
 */
export function espelhoRowDateForRecord(
  record: TimeRecord,
  periodStartYmd: string,
  periodEndYmd: string,
  scheduleByDay?: (date: string) => DayScheduleSlots | null | undefined,
): string {
  const civil = calendarDateForEspelhoRow(record, periodStartYmd, periodEndYmd);
  if (!scheduleByDay) return civil;
  const iso = recordMirrorInstant(record);
  const timeMin = localMinutesFromIso(iso);
  const yesterday = addDaysYmd(civil, -1);
  if (yesterday < periodStartYmd.slice(0, 10)) return civil;
  const prevSchedule = scheduleByDay(yesterday);
  if (prevSchedule && isNightShiftSchedule(prevSchedule)) {
    const cutoff = hhmmToMinutes(prevSchedule.saida_final) + (prevSchedule.toleranceMin ?? 60);
    if (timeMin <= cutoff) return yesterday;
  }
  return civil;
}

/**
 * Agrupa registros por data (respeita período do espelho — ver `calendarDateForEspelhoRow`).
 */
function groupRecordsByDate(
  records: TimeRecord[],
  periodStartYmd: string,
  periodEndYmd: string,
  scheduleByDay?: (date: string) => DayScheduleSlots | null | undefined,
): Map<string, TimeRecord[]> {
  const groups = new Map<string, TimeRecord[]>();

  for (const record of records) {
    const date = espelhoRowDateForRecord(record, periodStartYmd, periodEndYmd, scheduleByDay);
    if (!groups.has(date)) {
      groups.set(date, []);
    }
    groups.get(date)!.push(record);
  }

  return groups;
}

/**
 * Constrói o espelho de ponto completo para um funcionário
 */
/**
 * Resolve a batida exibida numa coluna do espelho (usa `slotRecordIds` quando disponível).
 */
export function resolveMirrorSlotRecord(
  day: DayMirror,
  slot: MirrorGridSlot,
  typeHint: NormalizedMirrorRecordType | null,
): TimeRecord | undefined {
  const preferId = day.slotRecordIds?.[slot];
  if (preferId) {
    return day.records.find((r) => r.id === preferId);
  }
  const timeStr =
    slot === 'entrada'
      ? day.entradaInicio
      : slot === 'saida_intervalo'
        ? day.saidaIntervalo
        : slot === 'volta_intervalo'
          ? day.voltaIntervalo
          : day.saidaFinal;
  if (!timeStr?.trim()) return undefined;
  if (typeHint) {
    const byType = day.records.find(
      (r) =>
        normalizeRecordTypeForMirror(r.type) === typeHint &&
        extractTime(recordEffectiveMirrorInstant(r, day.date)) === timeStr,
    );
    if (byType) return byType;
  }
  return day.records.find((r) => extractTime(recordEffectiveMirrorInstant(r, day.date)) === timeStr);
}

export function buildDayMirrorSummary(
  records: TimeRecord[],
  startDate: string,
  endDate: string,
  options?: {
    scheduleByDay?: (date: string) => DayScheduleSlots | null | undefined;
  }
): Map<string, DayMirror> {
  const byDate = groupRecordsByDate(records, startDate, endDate, options?.scheduleByDay);
  const result = new Map<string, DayMirror>();

  // Preenche todos os dias no período (sem problemas de fuso)
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = localCalendarYmd(d);
    const dayRecords = byDate.get(dateStr) || [];

    if (dayRecords.length > 0) {
      const daySchedule = options?.scheduleByDay?.(dateStr) ?? null;
      result.set(dateStr, buildDaySummary(dayRecords, dateStr, daySchedule));
    } else {
      // Dia sem registros
      result.set(dateStr, {
        date: dateStr,
        entradaInicio: null,
        saidaIntervalo: null,
        voltaIntervalo: null,
        saidaFinal: null,
        workedMinutes: 0,
        records: [],
        batidasExtra: [],
        inconsistencias: [],
      });
    }
  }
  
  return result;
}

/**
 * Formata minutos para exibição (HH:mm)
 */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/**
 * Verifica se um dia tem pelo menos uma batida manual
 */
export function hasManualRecord(dayMirror: DayMirror): boolean {
  return dayMirror.records.some(isManualRecord);
}

/**
 * Retorna o status do dia (FOLGA, FALTA, EXTRA, NORMAL, etc.)
 * @param workDays dias com jornada na escala (`Date.getDay()`: 0=dom … 6=sáb). Fora disso = folga (sem batida).
 * @param expectedWindow jornada esperada naquele dia (para EXTRA por fora da janela).
 * Folga: dia sem jornada na escala e sem batida. Falta: dia útil sem batidas ou sem as quatro colunas do espelho.
 */
export function getDayStatus(
  day: DayMirror,
  workDays?: number[],
  expectedWindow?: DayScheduleWindow | null,
  holidayDates?: Set<string>
): { status: string; label: string; color: string } {
  const override = getStatusOverride(day);
  if (override === 'folga') return { status: 'folga', label: 'FOLGA', color: 'green' };
  if (override === 'falta') return { status: 'falta', label: 'FALTA', color: 'red' };
  if (override === 'extra') return { status: 'extra', label: 'EXTRA', color: 'purple' };

  if (holidayDates?.has(day.date)) {
    return { status: 'holiday', label: 'FERIADO', color: 'amber' };
  }
  
  // Usa T12:00:00 para evitar problemas de fuso horário
  const date = new Date(day.date + 'T12:00:00');
  const dayOfWeek = date.getDay();
  const isWorkday = Array.isArray(workDays) && workDays.length > 0
    ? workDays.includes(dayOfWeek)
    : !(dayOfWeek === 0 || dayOfWeek === 6);
  
  const hasRecords = day.records.some((r) => !isStatusRecord(r));

  /** Dia sem jornada na escala (`workDays`): folga sem batidas; batidas em folga = extra. */
  if (!isWorkday) {
    if (hasRecords) return { status: 'extra', label: 'EXTRA', color: 'purple' };
    return { status: 'folga', label: 'FOLGA', color: 'green' };
  }

  // Dia útil sem batidas = falta
  if (!hasRecords) {
    return { status: 'falta', label: 'FALTA', color: 'red' };
  }

  // Dia útil: completo só com as quatro marcações (entrada, saída int., volta int., saída final)
  const fourComplete =
    !!day.entradaInicio &&
    !!day.saidaIntervalo &&
    !!day.voltaIntervalo &&
    !!day.saidaFinal;

  if (!fourComplete) {
    return { status: 'incomplete', label: 'INCOMPLETO', color: 'amber' };
  }

  if (expectedWindow) {
    const tol = expectedWindow.toleranceMin ?? 0;
    const startMin = parseHHmmToMinutes(expectedWindow.entrada);
    const endMin = parseHHmmToMinutes(expectedWindow.saida);
    const ent = parseHHmmToMinutes(day.entradaInicio);
    const sai = parseHHmmToMinutes(day.saidaFinal);
    if (startMin != null && endMin != null && ent != null && sai != null) {
      const early = ent < startMin - tol;
      const lateEnd = sai > endMin + tol;
      if (early || lateEnd) {
        return { status: 'extra', label: 'EXTRA', color: 'purple' };
      }
    }
  }

  return { status: 'normal', label: 'NORMAL', color: 'green' };
}
