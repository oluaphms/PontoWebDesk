/**
 * Mapa path → mesmo `import()` usado em React.lazy (portal).
 * Permite prefetch no hover/foco do menu antes do clique.
 */
export const ROUTE_LOADERS = {
  '/admin/dashboard': () => import('../pages/admin/Dashboard'),
  '/admin/employees': () => import('../pages/admin/Employees'),
  '/admin/import-employees': () => import('../pages/admin/ImportEmployees'),
  '/admin/timesheet': () => import('../pages/admin/Timesheet'),
  '/admin/cartao-ponto': () => import('../pages/admin/CartaoPonto'),
  '/admin/cartao-ponto-leitura': () => import('../pages/admin/CartaoPonto'),
  '/admin/lancamento-eventos': () => import('../pages/admin/LancamentoEventos'),
  '/admin/time-attendance': () => import('../pages/TimeAttendance'),
  '/admin/adjustments': () => import('../pages/Adjustments'),
  '/admin/absences': () => import('../pages/Absences'),
  '/admin/ausencias': () => import('../pages/Ausencias'),
  '/admin/requests': () => import('../pages/Requests'),
  '/admin/monitoring': () => import('../pages/admin/Monitoring'),
  '/admin/schedules': () => import('../pages/admin/Schedules'),
  '/admin/shifts': () => import('../pages/admin/Shifts'),
  '/admin/departments': () => import('../pages/Departments'),
  '/admin/job-titles': () => import('../pages/admin/JobTitles'),
  '/admin/estruturas': () => import('../pages/admin/Estruturas'),
  '/admin/cidades': () => import('../pages/admin/Cidades'),
  '/admin/estados-civis': () => import('../pages/admin/EstadosCivis'),
  '/admin/eventos': () => import('../pages/admin/Eventos'),
  '/admin/motivo-demissao': () => import('../pages/admin/MotivoDemissao'),
  '/admin/feriados': () => import('../pages/admin/Feriados'),
  '/admin/justificativas': () => import('../pages/admin/Justificativas'),
  '/admin/arquivar-calculos': () => import('../pages/admin/ArquivarCalculos'),
  '/admin/colunas-mix': () => import('../pages/admin/ColunasMix'),
  '/admin/ponto-diario': () => import('../pages/admin/PontoDiario'),
  '/admin/ponto-diario-leitura': () => import('../pages/admin/PontoDiario'),
  '/admin/arquivos-fiscais': () => import('../pages/admin/ArquivosFiscais'),
  '/admin/rep-devices': () => import('../pages/admin/RepDevices'),
  '/admin/rep-monitor': () => import('../pages/admin/RepMonitor'),
  '/admin/import-rep': () => import('../pages/admin/ImportRep'),
  '/admin/fiscalizacao': () => import('../pages/admin/Fiscalizacao'),
  '/admin/security': () => import('../pages/admin/Security'),
  '/admin/company': () => import('../pages/admin/Company'),
  '/admin/reports': () => import('../pages/admin/Reports'),
  '/admin/reports/work-hours': () => import('../pages/admin/reports/ReportWorkHours'),
  '/admin/reports/overtime': () => import('../pages/admin/reports/ReportOvertime'),
  '/admin/reports/inconsistencies': () => import('../pages/admin/reports/ReportInconsistencies'),
  '/admin/reports/bank-hours': () => import('../pages/admin/reports/ReportBankHours'),
  '/admin/reports/security': () => import('../pages/admin/reports/ReportSecurity'),
  '/admin/bank-hours': () => import('../pages/admin/BankHours'),
  '/admin/ajuda': () => import('../pages/admin/Ajuda'),
  '/admin/settings': () => import('../pages/admin/Settings'),

  '/employee/dashboard': () => import('../pages/employee/Dashboard'),
  '/employee/work-schedule': () => import('../pages/employee/MyWorkSchedule'),
  '/employee/clock': () => import('../pages/employee/ClockIn'),
  '/employee/timesheet': () => import('../pages/employee/Timesheet'),
  '/employee/monitoring': () => import('../pages/employee/Monitoring'),
  '/employee/requests': () => import('../pages/Requests'),
  '/employee/absences': () => import('../pages/Absences'),
  '/employee/profile': () => import('../pages/employee/Profile'),
  '/employee/settings': () => import('../pages/employee/Settings'),
  '/employee/time-balance': () => import('../pages/TimeBalance'),

  '/dashboard-admin': () => import('../pages/admin/Dashboard'),
  '/dashboard-employee': () => import('../pages/employee/Dashboard'),
  '/time-clock': () => import('../pages/TimeClock'),
  '/time-records': () => import('../pages/TimeRecords'),
  '/settings': () => import('../pages/Settings'),
  '/profile': () => import('../../components/ProfileView'),
  '/employees': () => import('../pages/Employees'),
  '/schedules': () => import('../pages/Schedules'),
  '/real-time-insights': () => import('../pages/RealTimeInsights'),
  '/company': () => import('../pages/Company'),
  '/reports': () => import('../pages/Reports'),

  '/reset-password': () => import('../pages/ResetPassword'),
  '/accept-invite': () => import('../pages/AcceptInvite'),
} as const;

const prefetched = new Set<string>();

function normalizePath(path: string): string {
  const p = path.split('?')[0].trim();
  if (p.length <= 1) return p;
  return p.replace(/\/$/, '');
}

/**
 * Dispara download/parsing do chunk da rota (idempotente por sessão de hover).
 */
export function prefetchPortalRoute(pathname: string): void {
  const p = normalizePath(pathname);
  if (!p || prefetched.has(p)) return;
  const loader = (ROUTE_LOADERS as Record<string, () => Promise<unknown>>)[p];
  if (typeof loader !== 'function') return;
  prefetched.add(p);
  void loader().catch(() => {
    prefetched.delete(p);
  });
}
