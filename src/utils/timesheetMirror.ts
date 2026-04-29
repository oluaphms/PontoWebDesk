/**
 * Utilitários para construir o espelho de ponto (timesheet mirror)
 * Processa time_records e organiza por dia/funcionário
 */

import { localCalendarYmd } from './localDateTimeToIso';

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
}

/** Batida vinda do REP / relógio (priorizar na coluna «Entrada» do espelho). */
export function isRepMirrorRecord(record: TimeRecord): boolean {
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
 * Data civil (YYYY-MM-DD) para agrupar a batida no espelho no período [start,end].
 * Se o instante oficial (`timestamp`) cai fora do período mas `created_at` cai dentro (ex.: AFD com ano errado,
 * importação REP tardia), usa a data de `created_at` para a grelha — senão a batida «sumia» em abril/2026.
 */
export function calendarDateForEspelhoRow(
  record: TimeRecord,
  periodStartYmd: string,
  periodEndYmd: string
): string {
  const primary = extractLocalCalendarDateFromIso(recordIso(record));
  if (primary >= periodStartYmd && primary <= periodEndYmd) return primary;
  const fallback = extractLocalCalendarDateFromIso(record.created_at);
  if (fallback >= periodStartYmd && fallback <= periodEndYmd) return fallback;
  return primary;
}

/**
 * Combina um dia civil local (YYYY-MM-DD) com hora/minuto/segundo **locais** do instante da batida,
 * para quando a batida cai na grelha por `created_at` mas o relógio oficial (`timestamp`) está noutro ano/dia.
 */
function mergeLocalCalendarDayWithWallTimeFromInstant(dayYmd: string, instantIso: string): string {
  const t = new Date(instantIso);
  const [ys, ms, ds] = dayYmd.split('-');
  const y = parseInt(ys || '0', 10);
  const mo = parseInt(ms || '1', 10);
  const d = parseInt(ds || '1', 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return instantIso;
  }
  const merged = new Date(y, mo - 1, d, t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds());
  return merged.toISOString();
}

/**
 * Instantâneo usado para horas no dia `dayDateStr` da grelha: alinha com `calendarDateForEspelhoRow`.
 * Se o dia da grelha veio do `created_at` (timestamp fora do período), preserva o horário de parede do `timestamp`.
 */
export function recordEffectiveMirrorInstant(record: TimeRecord, dayDateStr: string): string {
  const pri = extractLocalCalendarDateFromIso(recordIso(record));
  if (pri === dayDateStr) return recordIso(record);
  const ca = extractLocalCalendarDateFromIso(record.created_at);
  if (ca === dayDateStr) {
    const ts = record.timestamp && String(record.timestamp).trim();
    if (ts) {
      return mergeLocalCalendarDayWithWallTimeFromInstant(dayDateStr, ts);
    }
    return record.created_at;
  }
  return recordIso(record);
}

export interface DayMirror {
  date: string;
  entradaInicio: string | null;
  saidaIntervalo: string | null;
  voltaIntervalo: string | null;
  saidaFinal: string | null;
  workedMinutes: number;
  records: TimeRecord[];
}

/** Janela da escala no dia (entrada/saída esperadas) — opcional para status “extra” só fora da janela. */
export interface DayScheduleWindow {
  entrada: string;
  saida: string;
  toleranceMin?: number;
}

function parseHHmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
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

/**
 * Data civil local (YYYY-MM-DD) a partir de um instante ISO — alinha com filtros em UTC e com batidas gravadas via horário local.
 */
export function extractLocalCalendarDateFromIso(isoString: string): string {
  const date = new Date(isoString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function recordIso(record: TimeRecord): string {
  return recordMirrorInstant(record);
}

/**
 * Verifica se um registro é manual (tem manual_reason ou is_manual=true)
 */
export function isManualRecord(record: TimeRecord): boolean {
  return !!(record.manual_reason && record.manual_reason.trim()) || record.is_manual === true;
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
 * Constrói o resumo diário a partir dos registros de um dia
 */
/** Indica tipo «pausa» vindo do hardware (E/S/P) ou texto legado. */
function isPausaRawType(record: TimeRecord): boolean {
  const raw = String(record.type ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return raw === 'pausa' || raw === 'p';
}

/**
 * Ordena batidas do dia e expõe horários — útil para debug e regras por sequência (1ª…4ª).
 */
export function classifyPunch(recordsDoDia: TimeRecord[], dayDateStr: string): {
  sorted: TimeRecord[];
  times: string[];
} {
  const realRecords = recordsDoDia.filter((r) => !isStatusRecord(r));
  const sorted = sortRecordsByTime(realRecords, dayDateStr);
  const times = sorted.map((r) => extractTime(recordEffectiveMirrorInstant(r, dayDateStr)));
  if (import.meta.env.DEV && sorted.length === 4) {
    // eslint-disable-next-line no-console
    console.log('[CLASSIFY] registros do dia:', sorted.length);
    // eslint-disable-next-line no-console
    console.log('[CLASSIFY] ordem:', times.join(', '));
    // eslint-disable-next-line no-console
    console.log('[CLASSIFY] tipos: entrada, saída_int, volta_int, saída');
  }
  return { sorted, times };
}

function buildDaySummary(records: TimeRecord[], dayDateStr: string): DayMirror {
  const realRecords = records.filter((r) => !isStatusRecord(r));
  const sanitized = dedupeRepRecordsForMirror(realRecords, dayDateStr);
  const sorted = sortRecordsByTime(sanitized, dayDateStr);
  const date = dayDateStr;

  // Usar Map para garantir 1 batida = 1 coluna (sem duplicação)
  const timeByType = new Map<string, string>();

  // Mapear explicitamente tipo -> coluna (1:1, sem inferência por horário)
  for (const record of sorted) {
    const time = extractTime(recordEffectiveMirrorInstant(record, dayDateStr));
    const norm = normalizeRecordTypeForMirror(record.type);

    // Cada tipo vai para sua coluna específica
    // Se houver múltiplas batidas do mesmo tipo, a última (mais recente) prevalece
    switch (norm) {
      case 'entrada':
        // Para entrada, preservar a primeira batida do dia (não sobrescrever com entradas posteriores).
        if (!timeByType.has('entrada')) {
          timeByType.set('entrada', time);
        }
        break;
      case 'saida':
        timeByType.set('saida', time);
        break;
      case 'intervalo_saida':
        timeByType.set('intervalo_saida', time);
        break;
      case 'intervalo_volta':
        timeByType.set('intervalo_volta', time);
        break;
      default:
        // Ignorar tipos desconhecidos
        break;
    }
  }

  // Extrair valores do Map (1 batida = 1 coluna, sem duplicação)
  let entradaInicio: string | null = timeByType.get('entrada') || null;
  let saidaIntervalo: string | null = timeByType.get('intervalo_saida') || null;
  let voltaIntervalo: string | null = timeByType.get('intervalo_volta') || null;
  let saidaFinal: string | null = timeByType.get('saida') || null;

  // Fallback por ordem cronológica APENAS quando tipos estão incompletos
  // CORREÇÃO DEFINITIVA: Evitar duplicação de horários entre colunas
  const times = sorted.map((r) => extractTime(recordEffectiveMirrorInstant(r, dayDateStr)));
  const uniqueTimes = [...new Set(times)]; // Remove duplicatas de horário

  // Só aplicar fallback se não tivermos o tipo específico mapeado
  if (!entradaInicio && uniqueTimes.length > 0) entradaInicio = uniqueTimes[0];

  // Para 2 batidas sem tipos definidos: assume entrada e saída
  if (uniqueTimes.length === 2 && !saidaIntervalo && !voltaIntervalo && !saidaFinal) {
    saidaFinal = uniqueTimes[1];
  }

  // Para 3 batidas sem tipos de intervalo: assume entrada, saída intervalo, volta
  if (uniqueTimes.length === 3 && !saidaIntervalo && !voltaIntervalo) {
    saidaIntervalo = uniqueTimes[1];
    voltaIntervalo = uniqueTimes[2];
  }

  // Para 4+ batidas sem tipos completos: distribui sequencialmente
  if (uniqueTimes.length >= 4) {
    if (!saidaIntervalo) saidaIntervalo = uniqueTimes[1];
    if (!voltaIntervalo) voltaIntervalo = uniqueTimes[2];
    if (!saidaFinal) saidaFinal = uniqueTimes[3];
  }

  // CORREÇÃO: Simplificar caso de jornada sem intervalo (apenas entrada/saída)
  const hasIntervalType = sanitized.some((r) => {
    const n = normalizeRecordTypeForMirror(r.type);
    return n === 'intervalo_saida' || n === 'intervalo_volta';
  });
  const entradas = sanitized.filter((r) => normalizeRecordTypeForMirror(r.type) === 'entrada').length;
  const saidas = sanitized.filter((r) => normalizeRecordTypeForMirror(r.type) === 'saida').length;

  // Se só tem entrada e saída (sem intervalos definidos), limpa colunas de intervalo
  if (!hasIntervalType && entradas >= 1 && saidas >= 1 && uniqueTimes.length === 2) {
    saidaIntervalo = null;
    voltaIntervalo = null;
    if (!saidaFinal) saidaFinal = uniqueTimes[1];
  }

  // Entrada «oficial» do dia: se existir marcação do relógio com tipo entrada, prevalece sobre
  // mobile/web (evita intervalo ou batida errada ocupar a coluna Entrada).
  const repEntradas = sorted.filter(
    (r) =>
      isRepMirrorRecord(r) && normalizeRecordTypeForMirror(r.type) === 'entrada',
  );
  const hasNonRepEntrada = sorted.some(
    (r) => !isRepMirrorRecord(r) && normalizeRecordTypeForMirror(r.type) === 'entrada',
  );
  if (repEntradas.length > 0 && !hasNonRepEntrada) {
    repEntradas.sort(
      (a, b) =>
        new Date(recordEffectiveMirrorInstant(a, dayDateStr)).getTime() -
        new Date(recordEffectiveMirrorInstant(b, dayDateStr)).getTime(),
    );
    const firstRep = repEntradas[0];
    entradaInicio = extractTime(recordEffectiveMirrorInstant(firstRep, dayDateStr));
  }

  // Início de intervalo no mobile gravado como segunda «entrada» (erro comum) em vez de pausa:
  // com só 2 batidas o fallback `middle = times.slice(1,-1)` fica vazio e o horário «some» do espelho.
  if (!saidaIntervalo) {
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const next = sorted[i + 1];
      if (isStatusRecord(cur) || isStatusRecord(next)) continue;
      const ct = normalizeRecordTypeForMirror(cur.type);
      const nt = normalizeRecordTypeForMirror(next.type);
      const tCur = new Date(recordEffectiveMirrorInstant(cur, dayDateStr)).getTime();
      const tNext = new Date(recordEffectiveMirrorInstant(next, dayDateStr)).getTime();
      if (tNext <= tCur) continue;
      if (
        isRepMirrorRecord(cur) &&
        !isRepMirrorRecord(next) &&
        ct === 'entrada' &&
        nt === 'entrada'
      ) {
        saidaIntervalo = extractTime(recordEffectiveMirrorInstant(next, dayDateStr));
        break;
      }
    }
  }

  // Calcula minutos trabalhados
  let workedMinutes = 0;
  if (entradaInicio && saidaFinal) {
    const entrada = new Date(`${date}T${entradaInicio}`);
    const saida = new Date(`${date}T${saidaFinal}`);
    workedMinutes = Math.round((saida.getTime() - entrada.getTime()) / 60000);
    
    // Subtrai intervalo
    if (saidaIntervalo && voltaIntervalo) {
      const intervaloSaida = new Date(`${date}T${saidaIntervalo}`);
      const intervaloVolta = new Date(`${date}T${voltaIntervalo}`);
      workedMinutes -= Math.round((intervaloVolta.getTime() - intervaloSaida.getTime()) / 60000);
    }
  }
  
  return {
    date,
    entradaInicio,
    saidaIntervalo,
    voltaIntervalo,
    saidaFinal,
    workedMinutes: Math.max(0, workedMinutes),
    records,
  };
}

/**
 * Agrupa registros por data (respeita período do espelho — ver `calendarDateForEspelhoRow`).
 */
function groupRecordsByDate(
  records: TimeRecord[],
  periodStartYmd: string,
  periodEndYmd: string
): Map<string, TimeRecord[]> {
  const groups = new Map<string, TimeRecord[]>();

  for (const record of records) {
    const date = calendarDateForEspelhoRow(record, periodStartYmd, periodEndYmd);
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
export function buildDayMirrorSummary(
  records: TimeRecord[],
  startDate: string,
  endDate: string
): Map<string, DayMirror> {
  const byDate = groupRecordsByDate(records, startDate, endDate);
  const result = new Map<string, DayMirror>();

  // Preenche todos os dias no período (sem problemas de fuso)
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = localCalendarYmd(d);
    const dayRecords = byDate.get(dateStr) || [];

    if (dayRecords.length > 0) {
      result.set(dateStr, buildDaySummary(dayRecords, dateStr));
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
