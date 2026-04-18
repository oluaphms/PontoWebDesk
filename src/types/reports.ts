// ============================================================
// Tipos para Relatórios Padronizados do PontoWebDesk
// ============================================================

// ============================================================
// TIPOS BASE
// ============================================================

export interface ReportFilter {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  employeeIds?: string[];
  departmentIds?: string[];
  companyId: string;
}

export interface ReportHeader {
  title: string;
  company: string;
  period: string;
  filters: {
    employees?: string[];
    departments?: string[];
  };
  generatedAt: string;
}

/** Resumos podem incluir contagens, strings formatadas ou listas (ex.: ranking de risco). */
export interface ReportSummary {
  [key: string]: string | number | ReadonlyArray<unknown>;
}

export interface ReportExportOptions {
  format: 'pdf' | 'excel' | 'both';
  includeCharts?: boolean;
}

// ============================================================
// 1. RELATÓRIO DE JORNADA
// ============================================================

export interface JourneyRow {
  employee: string;
  date: string; // DD/MM/YYYY
  scheduledHours: string; // HH:MM
  workedHours: string; // HH:MM
  status: 'Cumprida' | 'Incompleta' | 'Excedida' | 'Ausente';
  statusColor: 'green' | 'yellow' | 'blue' | 'red';
}

export interface JourneySummary extends ReportSummary {
  totalDays: number;
  completedDays: number;
  incompleteDays: number;
  exceededDays: number;
  absentDays: number;
  completionRate: string; // percentage
}

export interface JourneyReport {
  header: ReportHeader;
  summary: JourneySummary;
  rows: JourneyRow[];
}

// ============================================================
// 2. RELATÓRIO DE HORAS EXTRAS
// ============================================================

export interface OvertimeRow {
  employee: string;
  date: string; // DD/MM/YYYY
  normalHours: string; // HH:MM
  extraHours: string; // HH:MM
  type: '50%' | '100%' | 'Banco de Horas';
  typeColor: 'orange' | 'red' | 'blue';
}

export interface OvertimeSummary extends ReportSummary {
  totalExtraHours: string; // HH:MM
  daysWithOvertime: number;
  hours50Percent: string; // HH:MM
  hours100Percent: string; // HH:MM
  bankHours: string; // HH:MM
}

export interface OvertimeReport {
  header: ReportHeader;
  summary: OvertimeSummary;
  rows: OvertimeRow[];
}

// ============================================================
// 3. RELATÓRIO DE INCONSISTÊNCIAS
// ============================================================

export interface InconsistencyRow {
  employee: string;
  date: string; // DD/MM/YYYY
  problem: 'Falta de batida' | 'Intervalo irregular' | 'Jornada incompleta' | 'Batida duplicada' | 'Outro';
  severity: 'Leve' | 'Média' | 'Crítica';
  severityColor: 'yellow' | 'orange' | 'red';
  details?: string;
}

export interface InconsistencySummary extends ReportSummary {
  totalInconsistencies: number;
  affectedEmployees: number;
  criticalIssues: number;
  mediumIssues: number;
  lightIssues: number;
}

export interface InconsistencyReport {
  header: ReportHeader;
  summary: InconsistencySummary;
  rows: InconsistencyRow[];
}

// ============================================================
// 4. RELATÓRIO DE BANCO DE HORAS
// ============================================================

export interface BankHoursRow {
  employee: string;
  previousBalance: string; // HH:MM (+ ou -)
  credit: string; // HH:MM
  debit: string; // HH:MM
  currentBalance: string; // HH:MM (+ ou -)
  balanceColor: 'green' | 'red';
}

export interface BankHoursSummary extends ReportSummary {
  totalPositive: string; // HH:MM
  totalNegative: string; // HH:MM
  employeesWithPositive: number;
  employeesWithNegative: number;
  netBalance: string; // HH:MM
}

export interface BankHoursReport {
  header: ReportHeader;
  summary: BankHoursSummary;
  rows: BankHoursRow[];
}

// ============================================================
// 5. RELATÓRIO DE SEGURANÇA (ANTIFRAUDE)
// ============================================================

export interface SecurityEvent {
  type: 'Localização inconsistente' | 'Troca de dispositivo' | 'Batida manual excessiva' | 'Falha de biometria' | 'Outro';
  count: number;
}

export interface SecurityRow {
  employee: string;
  date: string; // DD/MM/YYYY
  eventType: 'Localização inconsistente' | 'Troca de dispositivo' | 'Batida manual excessiva' | 'Falha de biometria' | 'Outro';
  riskLevel: 'Baixo' | 'Médio' | 'Alto';
  riskColor: 'green' | 'orange' | 'red';
  details?: string;
}

export interface SecuritySummary extends ReportSummary {
  suspiciousEvents: number;
  affectedEmployees: number;
  highRiskEvents: number;
  mediumRiskEvents: number;
  lowRiskEvents: number;
  topRiskEmployees: Array<{ name: string; riskCount: number }>;
}

export interface SecurityReport {
  header: ReportHeader;
  summary: SecuritySummary;
  rows: SecurityRow[];
}

// ============================================================
// 6. RELATÓRIO DE HORAS TRABALHADAS
// ============================================================

export interface WorkedHoursRow {
  employee: string;
  daysWorked: number;
  totalHours: string; // HH:MM
  averageDaily: string; // HH:MM
  percentage: string; // % of expected
}

export interface WorkedHoursSummary extends ReportSummary {
  totalGeneralHours: string; // HH:MM
  averagePerEmployee: string; // HH:MM
  totalEmployees: number;
  totalDaysWorked: number;
  averagePerDay: string; // HH:MM
}

export interface WorkedHoursReport {
  header: ReportHeader;
  summary: WorkedHoursSummary;
  rows: WorkedHoursRow[];
}

// ============================================================
// TIPOS GENÉRICOS
// ============================================================

export type Report =
  | JourneyReport
  | OvertimeReport
  | InconsistencyReport
  | BankHoursReport
  | SecurityReport
  | WorkedHoursReport;

export type ReportType =
  | 'journey'
  | 'overtime'
  | 'inconsistency'
  | 'bankHours'
  | 'security'
  | 'workedHours';

export interface ReportConfig {
  type: ReportType;
  title: string;
  description: string;
  icon: string;
  priority: 'high' | 'medium' | 'low';
}
