/**
 * Auditoria estática de isolamento multi-tenant (cache, realtime, query keys).
 */

import { validateTenantMemoryIsolation, assertTenantScopedCacheKey } from '../operational/cache/tenantCacheIsolation';

export type TenantIsolationAuditResult = {
  ok: boolean;
  violations: string[];
};

/**
 * Valida caches registrados e amostras de query keys / filtros de canal Supabase.
 */
export function auditTenantIsolationIntegrity(input?: {
  reactQueryKeySamples?: readonly (readonly unknown[])[];
  supabaseRealtimeFilters?: string[];
}): TenantIsolationAuditResult {
  const violations: string[] = [];

  const mem = validateTenantMemoryIsolation();
  if (!mem.ok) {
    for (const issue of mem.issues) {
      violations.push(`cache: ${issue}`);
      console.warn('[TENANT CACHE LEAK]', { issue });
    }
  }

  for (const qk of input?.reactQueryKeySamples ?? []) {
    const serialized = (() => {
      try {
        return JSON.stringify(qk);
      } catch {
        return String(qk);
      }
    })();
    if (serialized.includes('no-company') || serialized.includes('no-user')) {
      violations.push(`query_key_placeholder_tenant: ${serialized.slice(0, 160)}`);
      console.warn('[TENANT ISOLATION VIOLATION]', { kind: 'query_key', sample: serialized.slice(0, 200) });
    }
  }

  for (const filter of input?.supabaseRealtimeFilters ?? []) {
    const f = String(filter);
    if (f.includes('eq.') && !f.includes('company_id') && (f.includes('time_records') || f.includes('current_operational_state'))) {
      violations.push(`realtime_filter_without_company: ${f.slice(0, 160)}`);
      console.warn('[TENANT REALTIME LEAK]', { filter: f.slice(0, 200) });
    }
  }

  return { ok: violations.length === 0, violations };
}

/** Apenas observabilidade — não interrompe fluxos existentes. */
export function warnIfMissingCompanyId(companyId: string | null | undefined, source: string): boolean {
  if (companyId == null || String(companyId).trim() === '') {
    console.warn('[TENANT ISOLATION VIOLATION]', { reason: 'company_id_required', source });
    return false;
  }
  return true;
}

export { assertTenantScopedCacheKey };
