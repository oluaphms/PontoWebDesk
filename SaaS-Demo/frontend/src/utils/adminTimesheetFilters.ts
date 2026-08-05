/** Chave de sessionStorage — espelhada em Timesheet.tsx */
export function adminTimesheetFiltersKey(userId: string): string {
  return `pontowebdesk:admin-timesheet-filters:${userId}`;
}

/** Pré-seleciona colaborador no Espelho de Ponto antes de navegar. */
export function persistAdminTimesheetEmployeeFilter(adminUserId: string, employeeId: string): void {
  if (!adminUserId || !employeeId) return;
  try {
    const key = adminTimesheetFiltersKey(adminUserId);
    const raw = sessionStorage.getItem(key);
    const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...existing, filterUserId: employeeId }),
    );
  } catch {
    /* ignore quota / parse */
  }
}
