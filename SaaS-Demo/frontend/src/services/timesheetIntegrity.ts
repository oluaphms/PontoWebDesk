/**
 * Pré-validação antes de gravar em timesheets_daily.
 * FK `timesheets_daily.employee_id` → `auth.users(id)`; espelho em `public.users`.
 */

import { db } from './supabaseClient';

export type TimesheetIntegrityPayload = {
  employee_id: string;
  company_id: string;
};

export async function validateTimesheetIntegrity(
  payload: TimesheetIntegrityPayload,
): Promise<{ ok: boolean; reason?: string }> {
  const rows = (await db.select(
    'users',
    [{ column: 'id', operator: 'eq', value: payload.employee_id }],
    { columns: 'id, company_id, status', limit: 1 },
  )) as Array<{ id?: string; company_id?: string | null; status?: string | null }>;

  const row = rows?.[0];
  if (!row?.id) {
    return { ok: false, reason: 'employee_not_found' };
  }
  if (String(row.company_id ?? '') !== String(payload.company_id ?? '')) {
    return { ok: false, reason: 'cross_tenant_violation' };
  }

  const st = String(row.status ?? 'active').toLowerCase();
  if (st !== 'active' && st !== 'ativo') {
    return { ok: false, reason: 'inactive' };
  }

  return { ok: true };
}
