import type { PoolClient } from 'pg';
import { getRequestContext, updateRequestContext } from '../logger/logger.context.js';

export type TenantRlsContext = {
  companyId?: string | null;
  userId?: string | null;
  role?: string | null;
};

export function isVpsRlsEnforced(): boolean {
  const raw = String(process.env.VPS_RLS_ENFORCED ?? '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') {
    return String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production';
  }
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/** Define contexto tenant para RLS (ex.: agente REP após autenticação). */
export function setRepAgentTenantContext(companyId: string, deviceId?: string | null): void {
  updateRequestContext({
    companyId: String(companyId || '').trim() || null,
    userId: deviceId ? `rep-device:${deviceId}` : null,
    role: 'rep_agent',
  });
}

function normalizedContext(explicit?: TenantRlsContext): Required<TenantRlsContext> {
  const ctx = explicit ?? getRequestContext();
  return {
    companyId: String(ctx?.companyId ?? '').trim(),
    userId: String(ctx?.userId ?? '').trim(),
    role: String(ctx?.role ?? '').trim(),
  };
}

async function applyRlsConfig(
  client: PoolClient,
  context: TenantRlsContext,
  enforced: boolean,
): Promise<void> {
  const ctx = normalizedContext(context);
  const claims = JSON.stringify({
    sub: ctx.userId,
    user_id: ctx.userId,
    company_id: ctx.companyId,
    role: ctx.role,
  });

  await client.query(
    `select
       set_config('app.rls_enforced', $1, true),
       set_config('app.current_company_id', $2, true),
       set_config('app.current_user_id', $3, true),
       set_config('app.current_user_role', $4, true),
       set_config('request.jwt.claim.sub', $3, true),
       set_config('request.jwt.claim.user_id', $3, true),
       set_config('request.jwt.claim.company_id', $2, true),
       set_config('request.jwt.claim.role', $4, true),
       set_config('request.jwt.claims', $5, true)`,
    [enforced ? 'true' : 'false', ctx.companyId, ctx.userId, ctx.role, claims],
  );
}

/** Aplica o tenant dentro de uma transação já iniciada pelo chamador. */
export async function applyTenantRlsTransaction(
  client: PoolClient,
  explicitContext?: TenantRlsContext,
): Promise<void> {
  await applyRlsConfig(
    client,
    explicitContext ?? normalizedContext(),
    isVpsRlsEnforced(),
  );
}

/** Bootstrap interno e somente leitura para descobrir o tenant após validar credenciais. */
export async function applyTrustedBootstrapRlsTransaction(client: PoolClient): Promise<void> {
  await applyRlsConfig(client, {}, false);
}

/**
 * Contexto do control plane Master — RLS de tenant desligada.
 * Tabelas master_* não usam company_id operacional.
 * GUC app.master_control_plane=true permite projeção comercial em companies.
 */
export async function applyMasterControlPlaneRlsTransaction(client: PoolClient): Promise<void> {
  await applyRlsConfig(
    client,
    { companyId: null, userId: 'master-control-plane', role: 'master' },
    false,
  );
  await client.query(`select set_config('app.master_control_plane', 'true', true)`);
}
