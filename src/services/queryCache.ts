/**
 * Cache em memória para queries do Supabase.
 * Evita re-fetches desnecessários ao navegar entre páginas.
 * Sem dependências externas — substitui React Query para os casos mais comuns.
 */

import { useCatalogStore } from '../stores/catalogStore';
import {
  assertTenantScopedCacheKey,
  buildTenantCacheKey,
  registerTenantScopedCache,
  type TenantScope,
} from '../domain/operational/cache/tenantCacheIsolation';
import { recordMemoryCacheInvalidation } from '../performance/queryInvalidationAudit';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const HARD_LOCK_NO_CACHE_KEYS = ['timesheet', 'payroll', 'rep_punch_logs', 'jobs'];
let tenantCacheRegistryBootstrapped = false;

function isHardLockNoCacheKey(key: string): boolean {
  const normalized = String(key || '').toLowerCase();
  return HARD_LOCK_NO_CACHE_KEYS.some((token) => normalized.includes(token));
}

/** TTLs padrão por tipo de dado (ms) */
export const TTL = {
  /** Dados que mudam raramente: departamentos, cargos, escalas */
  STATIC: 5 * 60 * 1000,       // 5 min
  /** Dados que mudam com frequência moderada: funcionários, configurações */
  NORMAL: 60 * 1000,            // 1 min
  /** Dados de curta duração: dashboard admin, listas frequentes */
  SHORT: 30 * 1000,             // 30 s
  /** Dados em tempo real: registros de ponto, badges */
  REALTIME: 15 * 1000,          // 15 s
} as const;

export const queryCache = {
  get<T>(key: string): T | null {
    if (isHardLockNoCacheKey(key)) return null;
    const entry = store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.data;
  },

  set<T>(key: string, data: T, ttl: number): void {
    if (isHardLockNoCacheKey(key)) return;
    store.set(key, { data, expiresAt: Date.now() + ttl });
  },

  /**
   * Busca do cache ou executa o fetcher e armazena o resultado.
   * Deduplicação: chamadas simultâneas com a mesma key compartilham a mesma promise.
   */
  async getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<T> {
    if (isHardLockNoCacheKey(key)) {
      return fetcher();
    }
    const cached = queryCache.get<T>(key);
    if (cached !== null) return cached;

    // Deduplicação de chamadas em voo
    const inflight = inflightMap.get(key) as Promise<T> | undefined;
    if (inflight) return inflight;

    const promise = fetcher().then((data) => {
      this.set(key, data, ttl);
      inflightMap.delete(key);
      return data;
    }).catch((err) => {
      inflightMap.delete(key);
      throw err;
    });

    inflightMap.set(key, promise);
    return promise;
  },

  /** Invalida entradas que começam com o prefixo (ex: 'users:company123') */
  invalidate(prefix: string): void {
    let removed = 0;
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) {
      recordMemoryCacheInvalidation(prefix, removed);
      if (typeof console !== 'undefined') {
        console.info('[QUERY CACHE INVALIDATION]', { prefix, removed });
      }
    }
  },

  /** Limpa todo o cache (ex: no logout) */
  clear(): void {
    const size = store.size;
    store.clear();
    inflightMap.clear();
    if (size > 0) {
      recordMemoryCacheInvalidation('clear_all', size);
    }
    if (typeof console !== 'undefined') {
      console.info('[QUERY CACHE INVALIDATION]', { action: 'clear_all', removed: size });
    }
  },
};

const inflightMap = new Map<string, Promise<unknown>>();

function bootstrapTenantCacheRegistry(): void {
  if (tenantCacheRegistryBootstrapped) return;
  tenantCacheRegistryBootstrapped = true;
  registerTenantScopedCache({
    name: 'query_cache',
    clear: () => queryCache.clear(),
    validate: () => {
      const issues: string[] = [];
      for (const key of store.keys()) {
        if (isHardLockNoCacheKey(key)) continue;
        if (
          key.startsWith('users:') ||
          key.startsWith('time_records:') ||
          key.startsWith('admin_report:') ||
          key.startsWith('admin_bank_hours:')
        ) {
          try {
            assertTenantScopedCacheKey(key.replace(/^[^:]+:/, 'x:'));
          } catch (error) {
            issues.push(`key "${key}" sem escopo suficiente (${String(error)})`);
          }
        }
      }
      return issues;
    },
  });
}
bootstrapTenantCacheRegistry();

export function buildTenantQueryCacheKey(scope: Partial<TenantScope>, ...parts: Array<string | number>): string {
  const key = buildTenantCacheKey(scope, ...parts);
  assertTenantScopedCacheKey(key);
  return key;
}

/**
 * Chave estável para cache de relatórios admin (prefixo invalidado com `admin_report:${companyId}`).
 * Ex.: `adminReportCacheKey('co1', 'work_hours', '2026-04')` → `admin_report:co1:work_hours:2026-04`
 */
export function adminReportCacheKey(companyId: string, reportSlug: string, ...parts: string[]): string {
  return ['admin_report', companyId, reportSlug, ...parts].join(':');
}

/** Listas e KPIs admin (Dashboard, BankHours) — `users:`, `time_records:week:` e relatórios `admin_report:`. */
export function invalidateCompanyListCaches(companyId: string): void {
  if (!companyId) return;
  queryCache.invalidate(`users:${companyId}`);
  queryCache.invalidate(`time_records:week:${companyId}`);
  queryCache.invalidate(`time_records:admin_dash:v3:${companyId}`);
  queryCache.invalidate(`time_records:admin_dash:chart:${companyId}`);
  queryCache.invalidate(`time_records:admin_dash:recent:${companyId}`);
  queryCache.invalidate(`users:${companyId}:minimal`);
  queryCache.invalidate(`admin_report:${companyId}`);
  useCatalogStore.getState().clearCompany(companyId);
}

/**
 * Após batida de ponto: admin dashboard + dashboard do colaborador (registros recentes / banco de horas).
 */
export function invalidateAfterPunch(userId: string, companyId: string | undefined): void {
  if (!userId) return;
  if (companyId) {
    invalidateCompanyListCaches(companyId);
  }
  queryCache.invalidate(`time_records:user:${userId}`);
  queryCache.invalidate(`time_balance:${userId}`);
}

/**
 * Após fechar folha no Espelho de Ponto: atualiza saldos mensais, movimentos de banco de horas e KPIs admin.
 * Invalida caches com prefixo `admin_bank_hours:${companyId}` (Bank Hours) e todos os `time_balance:` (dashboard colaborador).
 */
export function invalidateAfterTimesheetMonthClose(companyId: string): void {
  if (!companyId) return;
  invalidateCompanyListCaches(companyId);
  queryCache.invalidate(`admin_bank_hours:${companyId}`);
  queryCache.invalidate('time_balance:');
}

/** Dashboard colaborador usa `requests:pending:${userId}` (ver pages/Dashboard.tsx). */
export function invalidatePendingRequestsCache(userId: string): void {
  if (!userId) return;
  queryCache.invalidate(`requests:pending:${userId}`);
}

/** Após criar/aprovar/excluir solicitação — invalida cache de todos os envolvidos (sem duplicar). */
export function invalidatePendingRequestsCachesForUsers(userIds: string[]): void {
  const seen = new Set<string>();
  for (const id of userIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    invalidatePendingRequestsCache(id);
  }
}
