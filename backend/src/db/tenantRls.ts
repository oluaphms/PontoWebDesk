import type { PoolClient } from 'pg';
import { getRequestContext, updateRequestContext } from '../logger/logger.context.js';

export function isVpsRlsEnforced(): boolean {
  return String(process.env.VPS_RLS_ENFORCED ?? '').trim().toLowerCase() === 'true';
}

/** Define contexto tenant para RLS (ex.: agente REP após autenticação). */
export function setRepAgentTenantContext(companyId: string, deviceId?: string | null): void {
  updateRequestContext({
    companyId: String(companyId || '').trim() || null,
    userId: deviceId ? `rep-device:${deviceId}` : null,
    role: 'rep_agent',
  });
}

export async function applyTenantRlsSession(client: PoolClient): Promise<void> {
  const ctx = getRequestContext();
  const enforced = isVpsRlsEnforced();
  await client.query(`select set_config('app.rls_enforced', $1, true)`, [enforced ? 'true' : 'false']);
  await client.query(`select set_config('app.current_company_id', $1, true)`, [
    String(ctx?.companyId ?? '').trim(),
  ]);
  await client.query(`select set_config('app.current_user_id', $1, true)`, [String(ctx?.userId ?? '').trim()]);
  await client.query(`select set_config('app.current_user_role', $1, true)`, [String(ctx?.role ?? '').trim()]);
}
