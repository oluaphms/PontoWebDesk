import { isAdminOrHr, isPrivilegedRole, normalizeRole } from './authContext.js';
import { buildPublicAllowedTables } from './dataTableAllowlist.js';

/** Escopo por user_id (sem filtro company_id automático). */
export const USER_SCOPED_TABLES = new Set([
  'users',
  'user_settings',
  'user_consents',
  'login_attempts',
]);

/** Somente admin/hr — sem filtro tenant automático. */
export const ADMIN_ONLY_TABLES = new Set(['companies']);

/** Admin/hr com escopo company_id (coluna tenant na tabela). */
export const TENANT_ADMIN_TABLES = new Set(['devices']);

/** Monitoramento, logs e integrações não são recursos de colaborador. */
const PRIVILEGED_ONLY_TABLES = new Set([
  'audit_log',
  'audit_logs',
  'audit_trail',
  'clock_event_logs',
  'clock_sync_logs',
  'company_backup_settings',
  'consent_logs',
  'current_operational_state',
  'device_keys',
  'device_operational_reputation',
  'device_operational_reputation_history',
  'employee_import_errors',
  'employee_import_logs',
  'engine_calc_audit',
  'fraud_alerts',
  'lgpd_security_events',
  'live_employee_heartbeat',
  'live_employee_location',
  'operational_alerts',
  'operational_audit_log',
  'operational_dead_letters',
  'operational_geo_forensics_history',
  'operational_incidents',
  'operational_legal_audit_trail',
  'operational_sla_config',
  'operational_state_history',
  'operational_tasks',
  'rep_device_audit_logs',
  'rep_device_checkpoints',
  'rep_device_commands',
  'rep_device_heartbeats',
  'rep_devices',
  'rep_logs',
  'rep_punch_logs',
  'rep_unresolved_punches',
  'tenant_audit_log',
  'time_attendance_audit_reviews',
  'time_attendance_audit_snapshots',
  'time_attendance_incident_reviews',
  'time_attendance_reliability_snapshots',
  'time_attendance_timeline',
  'time_engine_afd_audit',
  'time_record_change_log',
]);

/** Todas as tabelas public do dump Supabase + extras do app (paridade com cloud). */
export const ALLOWED_TABLES = buildPublicAllowedTables();

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
  'dpo_info',
  'device_keys',
]);

export function isGenericDataApiWritesEnabled(): boolean {
  const raw = String(process.env.DATA_API_WRITES_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0';
}

export function isTableReadable(table: string, role: string | undefined): boolean {
  if (!ALLOWED_TABLES.has(table)) return false;
  if (table === 'global_settings') return true;
  if (ADMIN_ONLY_TABLES.has(table) || TENANT_ADMIN_TABLES.has(table)) return isAdminOrHr(role);
  if (PRIVILEGED_ONLY_TABLES.has(table)) return isPrivilegedRole(role);
  return true;
}

export function isTableWritable(table: string, role: string | undefined): boolean {
  if (!ALLOWED_TABLES.has(table)) return false;
  if (ADMIN_ONLY_TABLES.has(table) || TENANT_ADMIN_TABLES.has(table)) return isAdminOrHr(role);
  if (PRIVILEGED_ONLY_TABLES.has(table)) return isPrivilegedRole(role);
  if (WRITE_REQUIRES_ADMIN_HR.has(table)) return isAdminOrHr(role);
  return true;
}

/** Tabelas tenant: permitidas na API e com escopo company_id quando a coluna existir. */
export function tableHasTenantScope(table: string): boolean {
  if (!ALLOWED_TABLES.has(table)) return false;
  if (ADMIN_ONLY_TABLES.has(table) || USER_SCOPED_TABLES.has(table)) return false;
  if (TENANT_ADMIN_TABLES.has(table)) return true;
  return true;
}

/**
 * Força company_id do JWT em inserts/updates de tabelas tenant.
 * tenant_id é somente leitura (gerada/computada) e não deve entrar em payload de escrita.
 */
export function applyTenantToRow(
  table: string,
  row: Record<string, unknown>,
  companyId: string,
): Record<string, unknown> {
  if (!tableHasTenantScope(table) || !companyId) return row;
  const next: Record<string, unknown> = { ...row, company_id: companyId };
  delete next.tenant_id;
  delete next.tenantId;
  return next;
}

/** @deprecated Use tenantScopeSqlForTable — evita referenciar tenant_id inexistente. */
export function tenantScopeSql(paramIndex: number): string {
  return `(company_id = $${paramIndex} OR tenant_id = $${paramIndex})`;
}

/** @deprecated Mantido para testes — use tableHasTenantScope. */
export const TENANT_TABLES = ALLOWED_TABLES;
