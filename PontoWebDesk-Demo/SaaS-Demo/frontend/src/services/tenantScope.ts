import type { TenantId, User } from '../../types';

/** Resolve o identificador do tenant (empresa) a partir do perfil — espelha companyId. */
export function resolveTenantId(user: Pick<User, 'companyId' | 'tenantId'> | null | undefined): TenantId {
  if (!user) return '';
  const t = user.tenantId ?? user.companyId;
  return (t ?? '').trim();
}

/** Garante que uma linha do PostgREST pertence ao tenant esperado (defesa em profundidade no app). */
export function assertRowTenant(
  row: { company_id?: string | null; tenant_id?: string | null },
  expectedTenant: TenantId,
  context?: string,
): void {
  const cid = row.tenant_id ?? row.company_id ?? '';
  if (!expectedTenant || cid !== expectedTenant) {
    const msg = context
      ? `Conflito de tenant (${context}): acesso negado.`
      : 'Conflito de tenant: acesso negado.';
    throw new Error(msg);
  }
}

/** Filtro Supabase/DB helper: preferir tenant_id se a migration já estiver aplicada. */
export function tenantEqFilter(tenantId: TenantId) {
  return { column: 'company_id' as const, operator: 'eq' as const, value: tenantId };
}
