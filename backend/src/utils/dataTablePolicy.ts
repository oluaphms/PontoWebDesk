import { isAdminOrHr, normalizeRole } from './authContext.js';

/** Tabelas com coluna company_id ou tenant_id — escopo obrigatório em leitura/escrita. */
export const TENANT_TABLES = new Set([
  'users',
  'employees',
  'departments',
  'time_records',
  'punches',
  'work_shifts',
  'schedules',
  'requests',
  'settings',
  'feriados',
  'justificativas',
  'eventos_folha',
  'lancamento_eventos',
  'job_titles',
  'cidades',
  'estados_civis',
  'motivo_demissao',
  'estruturas',
  'colaborador_jornada',
  'escala_mensal',
  'cartao_ponto_dia',
  'rep_devices',
  'rep_punch_logs',
  'bank_hours',
  'bank_hours_ledger',
  'time_balance',
  'work_locations',
  'trusted_devices',
  'employee_shift_schedule',
  'projects',
  'project_members',
  'project_tasks',
  'teams',
  'alerts',
  'fraud_alerts',
  'activity_sessions',
  'productivity_logs',
  'time_logs',
  'activity_logs',
  'company_rules',
  'overtime_rules',
  'folha_pagamento_periodos',
  'folha_pagamento_itens',
  'punch_interpretations',
  'time_adjustments_history',
  'tenant_audit_log',
  'audit_logs',
  'estrutura_responsaveis',
  'employee_absences',
  'absences',
  'ausencias',
  'events',
  'punch_risk_analysis',
  'rep_logs',
  'rep_unresolved_punches',
  'timesheets',
  'timesheet_daily_snapshots',
  'employee_invites',
  'clock_event_logs',
  'user_schedules',
]);

/** Escopo por user_id (sem company_id/tenant_id automático). */
export const USER_SCOPED_TABLES = new Set(['notifications']);

/** Somente admin/hr — sem filtro tenant automático ou dados globais sensíveis. */
export const ADMIN_ONLY_TABLES = new Set(['companies', 'global_settings', 'devices']);

export const ALLOWED_TABLES = new Set([
  ...TENANT_TABLES,
  ...USER_SCOPED_TABLES,
  ...ADMIN_ONLY_TABLES,
]);

const WRITE_REQUIRES_ADMIN_HR = new Set([
  'users',
  'employees',
  'departments',
  'settings',
  'global_settings',
  'companies',
  'devices',
  'rep_devices',
  'folha_pagamento_periodos',
  'folha_pagamento_itens',
  'company_rules',
  'overtime_rules',
  'employee_invites',
]);

export function isGenericDataApiWritesEnabled(): boolean {
  const raw = String(process.env.DATA_API_WRITES_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0';
}

export function isTableReadable(table: string, role: string | undefined): boolean {
  if (!ALLOWED_TABLES.has(table)) return false;
  if (ADMIN_ONLY_TABLES.has(table)) return isAdminOrHr(role);
  return true;
}

export function isTableWritable(table: string, role: string | undefined): boolean {
  if (!ALLOWED_TABLES.has(table)) return false;
  if (ADMIN_ONLY_TABLES.has(table)) return isAdminOrHr(role);
  if (WRITE_REQUIRES_ADMIN_HR.has(table)) return isAdminOrHr(role);
  return true;
}

export function tableHasTenantScope(table: string): boolean {
  return TENANT_TABLES.has(table);
}

/**
 * Força company_id do JWT em inserts/updates de tabelas tenant.
 * tenant_id só é aplicado em applyTenantToRowAsync (dataRowSchema), se a coluna existir.
 */
export function applyTenantToRow(
  table: string,
  row: Record<string, unknown>,
  companyId: string,
): Record<string, unknown> {
  if (!tableHasTenantScope(table) || !companyId) return row;
  return { ...row, company_id: companyId };
}

/** @deprecated Use tenantScopeSqlForTable — evita referenciar tenant_id inexistente. */
export function tenantScopeSql(paramIndex: number): string {
  return `(company_id = $${paramIndex} OR tenant_id = $${paramIndex})`;
}
