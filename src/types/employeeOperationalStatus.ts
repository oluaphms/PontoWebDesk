export enum EmployeeOperationalStatus {
  WORKING = 'WORKING',
  BREAK = 'BREAK',
  LUNCH = 'LUNCH',
  /** Última batida: saída (encerramento do período). */
  CLOSED = 'CLOSED',
  /** Sem batida operacional válida recente no feed (ex.: só batidas futuras rejeitadas). */
  INCONSISTENT = 'INCONSISTENT',
  /** Nenhum registro do colaborador no conjunto carregado. */
  NO_SHIFT = 'NO_SHIFT',
  /** Última batida válida é antiga demais para considerar “ao vivo”. */
  OFFLINE = 'OFFLINE',
  OFF_DUTY = 'OFF_DUTY',
}

/** Idade da última batida válida acima disso → status OFFLINE no monitoramento realtime. */
export const MONITORING_OFFLINE_AFTER_LAST_PUNCH_MS = 3 * 60 * 60 * 1000;

export function normalizePunchType(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function deriveOperationalStatusFromLastPunch(rawType: string | null | undefined): EmployeeOperationalStatus {
  const type = normalizePunchType(rawType);
  if (type === 'entrada') return EmployeeOperationalStatus.WORKING;
  if (type === 'pausa') return EmployeeOperationalStatus.BREAK;
  if (type === 'intervalo_saida') return EmployeeOperationalStatus.LUNCH;
  if (type === 'saida') return EmployeeOperationalStatus.CLOSED;
  return EmployeeOperationalStatus.OFF_DUTY;
}

/**
 * Status operacional realtime: última batida válida + idade; não usa boolean simplificado.
 */
export function computeRealtimeOperationalStatusFromTypeAndAge(
  rawType: string | null | undefined,
  ageMsSinceLastPunch: number,
  emptyValid: boolean,
  hasAnyRawRecordForUser: boolean,
): EmployeeOperationalStatus {
  if (emptyValid && !hasAnyRawRecordForUser) {
    return EmployeeOperationalStatus.NO_SHIFT;
  }
  if (emptyValid && hasAnyRawRecordForUser) {
    return EmployeeOperationalStatus.INCONSISTENT;
  }
  if (ageMsSinceLastPunch > MONITORING_OFFLINE_AFTER_LAST_PUNCH_MS) {
    return EmployeeOperationalStatus.OFFLINE;
  }
  return deriveOperationalStatusFromLastPunch(rawType);
}

export function operationalStatusLabel(status: EmployeeOperationalStatus): string {
  if (status === EmployeeOperationalStatus.WORKING) return 'Trabalhando';
  if (status === EmployeeOperationalStatus.BREAK) return 'Em pausa';
  if (status === EmployeeOperationalStatus.LUNCH) return 'Em intervalo';
  if (status === EmployeeOperationalStatus.CLOSED) return 'Encerrado';
  if (status === EmployeeOperationalStatus.OFFLINE) return 'Offline';
  if (status === EmployeeOperationalStatus.NO_SHIFT) return 'Sem jornada';
  if (status === EmployeeOperationalStatus.INCONSISTENT) return 'Inconsistente';
  return 'Fora da jornada';
}

export function operationalStatusColor(status: EmployeeOperationalStatus): string {
  if (status === EmployeeOperationalStatus.WORKING) {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
  }
  if (status === EmployeeOperationalStatus.BREAK) {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  }
  if (status === EmployeeOperationalStatus.LUNCH) {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
  }
  if (status === EmployeeOperationalStatus.CLOSED) {
    return 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300';
  }
  if (status === EmployeeOperationalStatus.OFFLINE) {
    return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
  }
  if (status === EmployeeOperationalStatus.NO_SHIFT) {
    return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  }
  if (status === EmployeeOperationalStatus.INCONSISTENT) {
    return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300';
  }
  return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
}
