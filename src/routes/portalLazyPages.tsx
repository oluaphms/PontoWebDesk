/**
 * Páginas do portal carregadas sob demanda (code splitting).
 * Usa os mesmos `import()` de `routeChunks.ts` (prefetch no hover).
 */
import React from 'react';
import { ROUTE_LOADERS } from './routeChunks';

export const TimeClockPage = React.lazy(ROUTE_LOADERS['/time-clock']);
export const TimeRecordsPage = React.lazy(ROUTE_LOADERS['/time-records']);
export const EmployeesPage = React.lazy(ROUTE_LOADERS['/employees']);
export const DepartmentsPage = React.lazy(ROUTE_LOADERS['/admin/departments']);
export const SchedulesPage = React.lazy(ROUTE_LOADERS['/schedules']);
export const RealTimeInsightsPage = React.lazy(ROUTE_LOADERS['/real-time-insights']);
export const CompanyPage = React.lazy(ROUTE_LOADERS['/company']);
export const ReportsPage = React.lazy(ROUTE_LOADERS['/reports']);
export const SettingsPage = React.lazy(ROUTE_LOADERS['/settings']);
export const TimeAttendancePage = React.lazy(ROUTE_LOADERS['/admin/time-attendance']);
export const AbsencesPage = React.lazy(ROUTE_LOADERS['/admin/absences']);
export const RequestsPage = React.lazy(ROUTE_LOADERS['/admin/requests']);

export const AdminDashboard = React.lazy(ROUTE_LOADERS['/admin/dashboard']);
export const AdminEmployees = React.lazy(ROUTE_LOADERS['/admin/employees']);
export const AdminTimesheet = React.lazy(ROUTE_LOADERS['/admin/timesheet']);
export const AdminMonitoring = React.lazy(ROUTE_LOADERS['/admin/monitoring']);
export const AdminSchedules = React.lazy(ROUTE_LOADERS['/admin/schedules']);
export const AdminShifts = React.lazy(ROUTE_LOADERS['/admin/shifts']);
export const AdminJobTitles = React.lazy(ROUTE_LOADERS['/admin/job-titles']);
export const AdminCompany = React.lazy(ROUTE_LOADERS['/admin/company']);
export const AdminReports = React.lazy(ROUTE_LOADERS['/admin/reports']);
export const AdminBankHours = React.lazy(ROUTE_LOADERS['/admin/bank-hours']);
export const ReportWorkHours = React.lazy(ROUTE_LOADERS['/admin/reports/work-hours']);
export const ReportOvertime = React.lazy(ROUTE_LOADERS['/admin/reports/overtime']);
export const ReportInconsistencies = React.lazy(ROUTE_LOADERS['/admin/reports/inconsistencies']);
export const ReportBankHours = React.lazy(ROUTE_LOADERS['/admin/reports/bank-hours']);
export const AdminSettings = React.lazy(ROUTE_LOADERS['/admin/settings']);
export const AdminEstruturas = React.lazy(ROUTE_LOADERS['/admin/estruturas']);
export const AdminCidades = React.lazy(ROUTE_LOADERS['/admin/cidades']);
export const AdminEstadosCivis = React.lazy(ROUTE_LOADERS['/admin/estados-civis']);
export const AdminEventos = React.lazy(ROUTE_LOADERS['/admin/eventos']);
export const AdminMotivoDemissao = React.lazy(ROUTE_LOADERS['/admin/motivo-demissao']);
export const AdminFeriados = React.lazy(ROUTE_LOADERS['/admin/feriados']);
export const AdminCartaoPonto = React.lazy(ROUTE_LOADERS['/admin/cartao-ponto']);
export const AdminLancamentoEventos = React.lazy(ROUTE_LOADERS['/admin/lancamento-eventos']);
export const AdminFolhaPagamento = React.lazy(ROUTE_LOADERS['/admin/folha-pagamento']);
export const AdminJustificativas = React.lazy(ROUTE_LOADERS['/admin/justificativas']);
export const AdminArquivarCalculos = React.lazy(ROUTE_LOADERS['/admin/arquivar-calculos']);
export const AdminColunasMix = React.lazy(ROUTE_LOADERS['/admin/colunas-mix']);
export const AdminPontoDiario = React.lazy(ROUTE_LOADERS['/admin/ponto-diario']);
export const AdminArquivosFiscais = React.lazy(ROUTE_LOADERS['/admin/arquivos-fiscais']);
export const AdminFiscalizacao = React.lazy(ROUTE_LOADERS['/admin/fiscalizacao']);
export const AdminSecurity = React.lazy(ROUTE_LOADERS['/admin/security']);
export const ReportSecurity = React.lazy(ROUTE_LOADERS['/admin/reports/security']);
export const ImportEmployees = React.lazy(ROUTE_LOADERS['/admin/import-employees']);
export const AdminRepDevices = React.lazy(ROUTE_LOADERS['/admin/rep-devices']);
export const AdminRepMonitor = React.lazy(ROUTE_LOADERS['/admin/rep-monitor']);
export const AdminImportRep = React.lazy(ROUTE_LOADERS['/admin/import-rep']);
export const AdminAusencias = React.lazy(ROUTE_LOADERS['/admin/ausencias']);
export const AdminAjuda = React.lazy(ROUTE_LOADERS['/admin/ajuda']);

export const EmployeeDashboard = React.lazy(ROUTE_LOADERS['/employee/dashboard']);
export const EmployeeClockIn = React.lazy(ROUTE_LOADERS['/employee/clock']);
export const EmployeeTimesheet = React.lazy(ROUTE_LOADERS['/employee/timesheet']);
export const EmployeeMonitoring = React.lazy(ROUTE_LOADERS['/employee/monitoring']);
export const EmployeeProfile = React.lazy(ROUTE_LOADERS['/employee/profile']);
export const EmployeeSettings = React.lazy(ROUTE_LOADERS['/employee/settings']);
export const MyWorkSchedule = React.lazy(ROUTE_LOADERS['/employee/work-schedule']);
export const TimeBalancePage = React.lazy(ROUTE_LOADERS['/employee/time-balance']);
export const EmployeeHolerite = React.lazy(ROUTE_LOADERS['/employee/holerite']);

export const ProfileViewLazy = React.lazy(ROUTE_LOADERS['/profile']);

export const ResetPasswordRoute = React.lazy(ROUTE_LOADERS['/reset-password']);
export const AcceptInviteRoute = React.lazy(ROUTE_LOADERS['/accept-invite']);
