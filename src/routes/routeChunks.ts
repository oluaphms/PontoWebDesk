/**
 * Mapa path → mesmo `import()` usado em React.lazy (portal).
 * Permite prefetch no hover/foco do menu antes do clique.
 */
type RouteLoader = () => Promise<unknown>;

function isTransientDynamicImportError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module')
  );
}

function withTransientRetry(loader: RouteLoader, retries = 2, delayMs = 350): RouteLoader {
  return async () => {
    try {
      return await loader();
    } catch (error) {
      if (!isTransientDynamicImportError(error) || retries <= 0) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return withTransientRetry(loader, retries - 1, delayMs)();
    }
  };
}

const RAW_ROUTE_LOADERS: Record<string, RouteLoader> = {
  '/admin/dashboard': () => import('../pages/admin/Dashboard'),
  '/admin/employees': () => import('../pages/admin/Employees'),
  '/admin/import-employees': () => import('../pages/admin/ImportEmployees'),
  '/admin/timesheet': () => import('../pages/admin/Timesheet'),
  '/admin/calculos': () => import('../pages/admin/Calculos'),
  '/admin/cartao-ponto': () => import('../pages/admin/CartaoPonto'),
  '/admin/cartao-ponto-leitura': () => import('../pages/admin/CartaoPonto'),
  '/admin/lancamento-eventos': () => import('../pages/admin/LancamentoEventos'),
  '/admin/pre-folha': () => import('../pages/admin/PreFolha'),
  '/admin/time-attendance': () => import('../pages/TimeAttendance'),
  '/admin/time-attendance-audit': () => import('../pages/admin/TimeAttendanceAudit'),
  '/admin/geolocation-audit': () => import('../pages/admin/GeolocationAudit'),
  '/admin/time-attendance-timeline': () => import('../pages/admin/TimeAttendanceTimeline'),
  '/admin/operational-incidents': () => import('../pages/admin/OperationalIncidents'),
  '/admin/operational-recovery': () => import('../pages/admin/OperationalRecovery'),
  '/admin/operational-health-check': () => import('../pages/admin/OperationalHealthCheck'),
  '/admin/operational-observability': () => import('../pages/admin/OperationalObservability'),
  '/admin/operational-load-report': () => import('../pages/admin/OperationalLoadReport'),
  '/admin/rep-operational-health': () => import('../pages/admin/RepOperationsCenter'),
  '/admin/rep-operations-center': () => import('../pages/admin/RepOperationsCenter'),
  '/admin/absences': () => import('../pages/Absences'),
  '/admin/ausencias': () => import('../pages/Ausencias'),
  '/admin/requests': () => import('../pages/Requests'),
  '/admin/monitoring': () => import('../pages/admin/Monitoring'),
  '/admin/schedules': () => import('../pages/admin/Schedules'),
  '/admin/shifts': () => import('../pages/admin/Shifts'),
  '/admin/colaborador-jornada': () => import('../pages/admin/ColaboradorJornada'),
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
  '/admin/import-rep': () => import('../pages/admin/ImportRep'),
  '/admin/rep-unresolved': () => import('../pages/admin/RepUnresolvedPunches'),
  '/admin/fiscalizacao': () => import('../pages/admin/Fiscalizacao'),
  '/admin/security': () => import('../pages/admin/Security'),
  '/admin/company': () => import('../pages/admin/Company'),
  '/admin/reports': () => import('../pages/admin/Reports'),
  '/admin/reports/read/:slug': () => import('../pages/admin/reports/ReportReadPage'),
  '/admin/reports/work-hours': () => import('../pages/admin/reports/ReportWorkHours'),
  '/admin/reports/overtime': () => import('../pages/admin/reports/ReportOvertime'),
  '/admin/reports/inconsistencies': () => import('../pages/admin/reports/ReportInconsistencies'),
  '/admin/reports/bank-hours': () => import('../pages/admin/reports/ReportBankHours'),
  '/admin/reports/security': () => import('../pages/admin/reports/ReportSecurity'),
  '/admin/bank-hours': () => import('../pages/admin/BankHours'),
  '/admin/ajuda': () => import('../pages/admin/Ajuda'),
  '/admin/settings': () => import('../pages/admin/Settings'),
  '/admin/metricas-produto': () => import('../pages/admin/MetricasProduto'),

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

export const ROUTE_LOADERS: Record<string, RouteLoader> = Object.fromEntries(
  Object.entries(RAW_ROUTE_LOADERS).map(([path, loader]) => [path, withTransientRetry(loader)]),
) as Record<string, RouteLoader>;

const prefetched = new Set<string>();

function normalizePath(path: string): string {
  const p = path.split('?')[0].trim();
  if (p.length <= 1) return p;
  const clean = p.replace(/\/$/, '');
  if (clean.startsWith('/admin/reports/read/')) return '/admin/reports/read/:slug';
  return clean;
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
