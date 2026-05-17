/**
 * Cache em memória para queries do Supabase.
 * Evita re-fetches desnecessários ao navegar entre páginas.
 * Sem dependências externas — substitui React Query para os casos mais comuns.
 */

import { useCatalogStore } from '../stores/catalogStore';
import {
  assertTenantScopedCacheKey,
  buildTenantCacheKey,
  bumpGeoCacheGeneration,
  registerTenantScopedCache,
  type TenantScope,
} from '../domain/operational/cache/tenantCacheIsolation';
import { recordMemoryCacheInvalidation } from '../performance/queryInvalidationAudit';
import { clearGeocodeCache } from './geolocation/reverseGeocode.service';
import { recordBrowserOnlineReconnectForOperationalResilience } from '../performance/reconnectLoopGuard';
import { opLog } from '../utils/operationalLogger';
import {
  invalidateDashboardQueriesForCompany,
  invalidateEmployeesQueries,
  invalidateOperationalStatusQueries,
  invalidatePunchRelatedReactQueries,
} from '../lib/reactQueryInvalidation';

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
      opLog.diag('QUERY CACHE INVALIDATION', { prefix, removed });
    }
  },

  /** Limpa todo o cache (ex: no logout) */
  clear(): void {
    bumpGeoCacheGeneration('query_cache_clear_all');
    const size = store.size;
    store.clear();
    inflightMap.clear();
    if (size > 0) {
      recordMemoryCacheInvalidation('clear_all', size);
    }
    opLog.diag('QUERY CACHE INVALIDATION', { action: 'clear_all', removed: size });
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
          key.startsWith('current_operational_state:') ||
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

/**
 * Coalesce de invalidações geo: múltiplas chamadas em rajada (ex.: ghost detector +
 * realtime stream + visibilitychange) viram UMA única operação dentro da janela.
 *
 * Sem coalesce, cada render no admin/Monitoring que dispara invalidate causa um
 * `bumpGeoCacheGeneration` + N `queryCache.invalidate(prefix)`. Com 30 funcionários
 * em tela isso vira centenas de operações redundantes por segundo.
 */
const GEO_HARD_INVALIDATION_COALESCE_MS = 200;
let pendingGeoHardInvalidation: { timer: ReturnType<typeof setTimeout>; reasons: Set<string>; coalesced: number } | null = null;

function flushGeoHardInvalidation(): void {
  if (!pendingGeoHardInvalidation) return;
  const { reasons, coalesced } = pendingGeoHardInvalidation;
  pendingGeoHardInvalidation = null;
  const reasonLabel = reasons.size === 1 ? Array.from(reasons)[0] : `coalesced(${reasons.size})`;
  bumpGeoCacheGeneration(reasonLabel);
  opLog.diag('GEO CACHE HARD INVALIDATION', {
    reasons: Array.from(reasons),
    coalesced,
  });
  queryCache.invalidate('current_operational_state:');
  queryCache.invalidate('time_records:admin_dash:');
  queryCache.invalidate('time_records:week:');
}

/** Invalidação dura de caches sensíveis a GEO / tenant (mobile, troca de aba, rede). */
export function invalidateOperationalGeoCaches(reason: string): void {
  if (pendingGeoHardInvalidation) {
    pendingGeoHardInvalidation.reasons.add(reason);
    pendingGeoHardInvalidation.coalesced += 1;
    return;
  }
  pendingGeoHardInvalidation = {
    timer: setTimeout(flushGeoHardInvalidation, GEO_HARD_INVALIDATION_COALESCE_MS),
    reasons: new Set([reason]),
    coalesced: 1,
  };
}

/** Força flush imediato — útil para testes e para callbacks que precisam ler dados frescos. */
export function flushPendingGeoCacheInvalidations(): void {
  if (pendingGeoHardInvalidation) {
    clearTimeout(pendingGeoHardInvalidation.timer);
    flushGeoHardInvalidation();
  }
  if (pendingEntityInvalidations.size > 0) {
    for (const [, entry] of pendingEntityInvalidations) {
      clearTimeout(entry.timer);
    }
    const snapshot = Array.from(pendingEntityInvalidations.entries());
    pendingEntityInvalidations.clear();
    for (const [, entry] of snapshot) {
      flushRealtimeGeoEntity(entry.employeeId, entry.companyId, entry.coalesced);
    }
  }
}

export function __resetCacheInvalidationCoalescersForTests(): void {
  if (pendingGeoHardInvalidation) {
    clearTimeout(pendingGeoHardInvalidation.timer);
    pendingGeoHardInvalidation = null;
  }
  for (const [, entry] of pendingEntityInvalidations) {
    clearTimeout(entry.timer);
  }
  pendingEntityInvalidations.clear();
}

function installOperationalGeoCacheListeners(): void {
  if (typeof window === 'undefined') return;
  const g = globalThis as unknown as { __pontowebdeskGeoCacheListeners?: boolean };
  if (g.__pontowebdeskGeoCacheListeners) return;
  g.__pontowebdeskGeoCacheListeners = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      invalidateOperationalGeoCaches('visibilitychange');
    }
  });
  window.addEventListener('online', () => {
    recordBrowserOnlineReconnectForOperationalResilience();
    invalidateOperationalGeoCaches('online');
  });
  window.addEventListener('offline', () => invalidateOperationalGeoCaches('offline'));
}
installOperationalGeoCacheListeners();

/**
 * Coalesce de invalidações por colaborador. Mantém o efeito por entidade
 * (employeeId, companyId), mas comprime rajadas em 1 execução por janela.
 */
const ENTITY_INVALIDATION_COALESCE_MS = 250;
type PendingEntityEntry = {
  employeeId: string;
  companyId?: string;
  coalesced: number;
  timer: ReturnType<typeof setTimeout>;
};
const pendingEntityInvalidations = new Map<string, PendingEntityEntry>();

function entityKey(employeeId: string, companyId?: string): string {
  return `${companyId ?? 'no_company'}:${employeeId}`;
}

function flushRealtimeGeoEntity(employeeId: string, companyId: string | undefined, coalesced: number): void {
  bumpGeoCacheGeneration(`invalidateRealtimeGeoEntity:${employeeId}`);
  clearGeocodeCache();
  if (companyId) {
    queryCache.invalidate(`current_operational_state:${companyId}`);
    queryCache.invalidate(`time_records:admin_dash:recent:${companyId}`);
    queryCache.invalidate(`time_records:admin_dash:chart:${companyId}`);
  } else {
    queryCache.invalidate('current_operational_state:');
    queryCache.invalidate('time_records:admin_dash:');
  }
  opLog.diag('GEO ENTITY CACHE INVALIDATED', { employeeId, companyId, coalesced });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('smartponto:force-monitoring-refresh', { detail: { employeeId, companyId } }),
    );
  }
}

/**
 * Invalidação por colaborador (COS, registros recentes, enrich GEO, listeners de mapa).
 * Múltiplas chamadas para o mesmo (employeeId, companyId) são coalescidas em janela curta.
 */
export function invalidateRealtimeGeoEntity(employeeId: string, companyId?: string): void {
  if (!employeeId) return;
  const key = entityKey(employeeId, companyId);
  const existing = pendingEntityInvalidations.get(key);
  if (existing) {
    existing.coalesced += 1;
    return;
  }
  const entry: PendingEntityEntry = {
    employeeId,
    companyId,
    coalesced: 1,
    timer: setTimeout(() => {
      const snap = pendingEntityInvalidations.get(key);
      pendingEntityInvalidations.delete(key);
      flushRealtimeGeoEntity(employeeId, companyId, snap?.coalesced ?? 1);
    }, ENTITY_INVALIDATION_COALESCE_MS),
  };
  pendingEntityInvalidations.set(key, entry);
}

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
  invalidateEmployeesQueries(companyId);
  invalidateDashboardQueriesForCompany(companyId);
  queryCache.invalidate(`users:${companyId}`);
  queryCache.invalidate(`time_records:week:${companyId}`);
  queryCache.invalidate(`time_records:admin_dash:v3:${companyId}`);
  queryCache.invalidate(`time_records:admin_dash:chart:${companyId}`);
  queryCache.invalidate(`time_records:admin_dash:recent:${companyId}`);
  queryCache.invalidate(`current_operational_state:${companyId}`);
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
    const monthYyyyMm = new Date().toISOString().slice(0, 7);
    invalidatePunchRelatedReactQueries(companyId, userId, monthYyyyMm);
    invalidateOperationalStatusQueries(companyId);
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
