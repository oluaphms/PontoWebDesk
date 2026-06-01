import { isAdminOrHr, normalizeRole } from './authContext.js';
import { buildPublicAllowedTables } from './dataTableAllowlist.js';

/** Escopo por user_id (sem filtro company_id automático). */
export const USER_SCOPED_TABLES = new Set([
  'users',
  'notifications',
  'user_settings',
  'user_consents',
  'login_attempts',
]);

/** Somente admin/hr — sem filtro tenant automático. */
export const ADMIN_ONLY_TABLES = new Set(['companies', 'global_settings', 'devices']);

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
  if (ADMIN_ONLY_TABLES.has(table)) return isAdminOrHr(role);
  return true;
}

export function isTableWritable(table: string, role: string | undefined): boolean {
  if (!ALLOWED_TABLES.has(table)) return false;
  if (ADMIN_ONLY_TABLES.has(table)) return isAdminOrHr(role);
  if (WRITE_REQUIRES_ADMIN_HR.has(table)) return isAdminOrHr(role);
  return true;
}

/** Tabelas tenant: permitidas na API e com escopo company_id quando a coluna existir. */
export function tableHasTenantScope(table: string): boolean {
  if (!ALLOWED_TABLES.has(table)) return false;
  if (ADMIN_ONLY_TABLES.has(table) || USER_SCOPED_TABLES.has(table)) return false;
  return true;
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

/** @deprecated Mantido para testes — use tableHasTenantScope. */
export const TENANT_TABLES = ALLOWED_TABLES;
