export enum EmployeeOperationalStatus {
  WORKING = 'WORKING',
  BREAK = 'BREAK',
  LUNCH = 'LUNCH',
  OFF_DUTY = 'OFF_DUTY',
}

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
  if (type === 'saida') return EmployeeOperationalStatus.OFF_DUTY;
  return EmployeeOperationalStatus.OFF_DUTY;
}

export function operationalStatusLabel(status: EmployeeOperationalStatus): string {
  if (status === EmployeeOperationalStatus.WORKING) return 'Trabalhando';
  if (status === EmployeeOperationalStatus.BREAK) return 'Em pausa';
  if (status === EmployeeOperationalStatus.LUNCH) return 'Em intervalo';
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
  return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
}
