/**
 * Utilitários para construir o espelho de ponto (timesheet mirror)
 * Processa time_records e organiza por dia/funcionário
 */

export interface TimeRecord {
  id: string;
  user_id: string;
  created_at: string;
  type: 'entrada' | 'saida' | 'intervalo_saida' | 'intervalo_volta';
  manual_reason?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_manual?: boolean;
  adjusted?: boolean;
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

/**
 * Extrai apenas a hora (HH:mm) de uma data ISO
 */
function extractTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Extrai a data (YYYY-MM-DD) de uma string ISO
 */
function extractDate(isoString: string): string {
  return isoString.slice(0, 10);
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
function sortRecordsByTime(records: TimeRecord[]): TimeRecord[] {
  return [...records].sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/**
 * Constrói o resumo diário a partir dos registros de um dia
 */
function buildDaySummary(records: TimeRecord[]): DayMirror {
  const sorted = sortRecordsByTime(records);
  const date = extractDate(sorted[0]?.created_at || new Date().toISOString());
  
  let entradaInicio: string | null = null;
  let saidaIntervalo: string | null = null;
  let voltaIntervalo: string | null = null;
  let saidaFinal: string | null = null;
  
  // Interpreta a sequência de batidas baseado na ordem e tipo
  for (const record of sorted) {
    const time = extractTime(record.created_at);
    
    switch (record.type) {
      case 'entrada':
        if (!entradaInicio) {
          entradaInicio = time;
        } else if (!voltaIntervalo && saidaIntervalo) {
          // Segunda entrada após intervalo
          voltaIntervalo = time;
        }
        break;
      case 'saida':
        if (entradaInicio && !saidaIntervalo && !voltaIntervalo) {
          // Possível saída para intervalo ou saída final
          saidaIntervalo = time;
        } else if (voltaIntervalo || (!saidaIntervalo && entradaInicio)) {
          // Saída final
          saidaFinal = time;
        }
        break;
      case 'intervalo_saida':
        saidaIntervalo = time;
        break;
      case 'intervalo_volta':
        voltaIntervalo = time;
        break;
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
    records: sorted,
  };
}

/**
 * Agrupa registros por data
 */
function groupRecordsByDate(records: TimeRecord[]): Map<string, TimeRecord[]> {
  const groups = new Map<string, TimeRecord[]>();
  
  for (const record of records) {
    const date = extractDate(record.created_at);
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
  const byDate = groupRecordsByDate(records);
  const result = new Map<string, DayMirror>();
  
  // Preenche todos os dias no período (sem problemas de fuso)
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const dayRecords = byDate.get(dateStr) || [];
    
    if (dayRecords.length > 0) {
      result.set(dateStr, buildDaySummary(dayRecords));
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
 * Retorna o status do dia (FOLGA, FERIADO, FALTA, etc.)
 */
export function getDayStatus(day: DayMirror): { status: string; label: string; color: string } {
  // Verifica se é feriado
  // TODO: Implementar verificação de feriado quando tiver dados de feriados
  
  // Verifica se é dia de folga (fim de semana)
  // Usa T12:00:00 para evitar problemas de fuso horário
  const date = new Date(day.date + 'T12:00:00');
  const dayOfWeek = date.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  if (isWeekend) {
    return { status: 'folga', label: 'FOLGA', color: 'green' };
  }
  
  // Se não tem registros em dia útil = FALTA
  if (!day.records || day.records.length === 0) {
    return { status: 'falta', label: 'FALTA', color: 'red' };
  }
  
  // Dia normal com registros
  return { status: 'normal', label: '', color: 'slate' };
}
