import { observabilityConsole } from '../shared/logger/observabilityConsole';
import type { InvalidateQueryFilters, Query, QueryKey } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import { apiQueryKeys } from './apiQueryKeys';

const DEBOUNCE_MS = 300;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 10_000;

/** Opções: `force: true` ignora cooldown pós-login; `immediate: false` aplica debounce por domínio+tenant. */
export type MutationInvalidationOpts = {
  force?: boolean;
  /**
   * Padrão `true` (mutação): sem debounce, sem verificação `isStale`, sem backoff — refetch imediato.
   * `false`: debounce 300ms por `domain:tenant`; mantém `isStale` e backoff por domínio+tenant.
   */
  immediate?: boolean;
};

/** Chave estável para Maps — performático e alinhado a keys actuais (array de primitivos). */
export function stableKey(queryKey: QueryKey): string {
  return Array.isArray(queryKey) ? queryKey.map(String).join('|') : String(queryKey);
}

/** `queryKey[0]` + `queryKey[1] ?? 'global'` — debounce e backoff agregados por tenant. */
export function parseDomainTenant(qk: QueryKey | undefined): { domain: string; tenantId: string } {
  if (Array.isArray(qk) && qk.length > 0) {
    return {
      domain: String(qk[0]),
      tenantId: qk.length > 1 ? String(qk[1]) : 'global',
    };
  }
  return { domain: '_unknown', tenantId: 'global' };
}

export function debounceKeyFromQueryKey(qk: QueryKey | undefined): string {
  const { domain, tenantId } = parseDomainTenant(qk);
  return `${domain}:${tenantId}`;
}

function debounceKeyFromFilters(filters: InvalidateQueryFilters): string {
  return debounceKeyFromQueryKey(filters.queryKey as QueryKey | undefined);
}

const defaultMutationOpts: MutationInvalidationOpts = { force: true, immediate: true };

const pendingDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const debounceLatest = new Map<string, { filters: InvalidateQueryFilters; opts: MutationInvalidationOpts }>();

type BackoffState = { until: number; consecutiveErrors: number };
/** Backoff agregado por `domain:tenant` (evita fragmentação por query individual). */
const refetchBackoffByDomainTenant = new Map<string, BackoffState>();

function logDecision(
  key: QueryKey | undefined,
  reason: 'fresh' | 'fetching' | 'backoff' | 'debounce' | 'execute',
): void {
  if (!import.meta.env.DEV || typeof console === 'undefined') return;
  const { domain, tenantId } = parseDomainTenant(key);
  observabilityConsole.info('[CACHE DECISION]', { key, domain, tenantId, reason });
}

function devCacheLog(
  kind:
    | 'INVALIDATE'
    | 'REFETCH'
    | 'SKIP_MISS'
    | 'REFETCH_ERR'
    | 'STATE'
    | 'SKIP_FETCHING'
    | 'SKIP_BACKOFF'
    | 'SKIP_STILL_FRESH',
  detail: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV || typeof console === 'undefined') return;
  const label =
    kind === 'INVALIDATE'
      ? '[CACHE INVALIDATE]'
      : kind === 'REFETCH'
        ? '[CACHE REFETCH]'
        : kind === 'SKIP_MISS'
          ? '[CACHE MISS - FORCE INVALIDATE]'
          : kind === 'REFETCH_ERR'
            ? '[CACHE REFETCH ERROR]'
            : kind === 'STATE'
              ? '[CACHE STATE]'
              : kind === 'SKIP_FETCHING'
                ? '[CACHE SKIP - ALREADY FETCHING]'
                : kind === 'SKIP_BACKOFF'
                  ? '[CACHE SKIP - BACKOFF]'
                  : '[CACHE SKIP - STILL FRESH]';
  observabilityConsole.info(label, detail);
}

function findQueries(filters: InvalidateQueryFilters): Query[] {
  return queryClient.getQueryCache().findAll(filters);
}

function nextBackoffMs(consecutiveErrors: number): number {
  const n = Math.max(1, consecutiveErrors);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

/**
 * Refetch por instâncias em cache (activas + inactivas).
 * `invalidateQueries` usa `refetchType: 'none'`; o refetch é controlado aqui.
 */
async function refetchMatchingWithGuards(
  filters: InvalidateQueryFilters,
  opts: MutationInvalidationOpts,
): Promise<void> {
  const queries = findQueries(filters);
  const force = opts.force !== false;
  /** Mutação: sem `isStale`, sem backoff; mantém protecção a `fetching`. */
  const skipStaleAndBackoff = opts.immediate !== false;

  for (const query of queries) {
    const aggregateKey = debounceKeyFromQueryKey(query.queryKey);
    const backoff = refetchBackoffByDomainTenant.get(aggregateKey);

    if (!skipStaleAndBackoff && Date.now() < (backoff?.until ?? 0)) {
      logDecision(query.queryKey, 'backoff');
      devCacheLog('SKIP_BACKOFF', {
        queryKey: query.queryKey,
        debounceKey: aggregateKey,
        until: backoff?.until,
      });
      continue;
    }

    if (query.state.fetchStatus === 'fetching') {
      logDecision(query.queryKey, 'fetching');
      devCacheLog('SKIP_FETCHING', { queryKey: query.queryKey });
      continue;
    }

    if (!skipStaleAndBackoff && !query.isStale()) {
      logDecision(query.queryKey, 'fresh');
      devCacheLog('SKIP_STILL_FRESH', { queryKey: query.queryKey });
      continue;
    }

    logDecision(query.queryKey, 'execute');
    devCacheLog('REFETCH', { queryKey: query.queryKey });

    try {
      await query.fetch();
      refetchBackoffByDomainTenant.delete(aggregateKey);
      if (import.meta.env.DEV && typeof console !== 'undefined') {
        observabilityConsole.info('[CACHE STATE]', {
          key: query.queryKey,
          isStale: query.isStale(),
          dataUpdatedAt: query.state.dataUpdatedAt,
          fetchStatus: query.state.fetchStatus,
        });
      }
    } catch (e) {
      if (!skipStaleAndBackoff) {
        const prev = refetchBackoffByDomainTenant.get(aggregateKey);
        const consecutiveErrors = (prev?.consecutiveErrors ?? 0) + 1;
        const backoffMs = nextBackoffMs(consecutiveErrors);
        const until = Date.now() + backoffMs;
        refetchBackoffByDomainTenant.set(aggregateKey, { until, consecutiveErrors });
        devCacheLog('REFETCH_ERR', {
          queryKey: query.queryKey,
          debounceKey: aggregateKey,
          error: e instanceof Error ? e.message : String(e),
          backoffMs,
          consecutiveErrors,
        });
      } else if (import.meta.env.DEV) {
        devCacheLog('REFETCH_ERR', {
          queryKey: query.queryKey,
          debounceKey: aggregateKey,
          error: e instanceof Error ? e.message : String(e),
          note: 'mutation path: backoff not applied',
        });
      }
    }
  }
}

async function invalidateThenRefetchInner(
  filters: InvalidateQueryFilters,
  opts: MutationInvalidationOpts = defaultMutationOpts,
): Promise<void> {
  const force = opts.force !== false;
  const queries = findQueries(filters);

  if (!queries.length) {
    if (import.meta.env.DEV) {
      devCacheLog('SKIP_MISS', { queryKey: filters.queryKey });
    }
    await queryClient.invalidateQueries(
      { ...filters, refetchType: 'none' } as InvalidateQueryFilters,
      { force } as never,
    );
    return;
  }

  const queryKey = filters.queryKey as QueryKey | undefined;
  devCacheLog('INVALIDATE', { queryKey, force });

  await queryClient.invalidateQueries(
    { ...filters, refetchType: 'none' } as InvalidateQueryFilters,
    { force } as never,
  );

  await refetchMatchingWithGuards(filters, opts);
}

function cancelDebounceTimerOnly(debounceKey: string): void {
  const t = pendingDebounceTimers.get(debounceKey);
  if (t !== undefined) {
    clearTimeout(t);
    pendingDebounceTimers.delete(debounceKey);
  }
}

function clearDebounceForKey(debounceKey: string): void {
  cancelDebounceTimerOnly(debounceKey);
  debounceLatest.delete(debounceKey);
}

function scheduleOrRunInvalidateThenRefetch(
  filters: InvalidateQueryFilters,
  opts: MutationInvalidationOpts = defaultMutationOpts,
): void {
  const debounceKey = debounceKeyFromFilters(filters);
  const immediate = opts.immediate !== false;

  if (immediate) {
    clearDebounceForKey(debounceKey);
    void invalidateThenRefetchInner(filters, opts);
    return;
  }

  logDecision(filters.queryKey as QueryKey | undefined, 'debounce');
  debounceLatest.set(debounceKey, { filters, opts });
  cancelDebounceTimerOnly(debounceKey);
  const timer = setTimeout(() => {
    pendingDebounceTimers.delete(debounceKey);
    const payload = debounceLatest.get(debounceKey);
    debounceLatest.delete(debounceKey);
    if (payload) {
      logDecision(payload.filters.queryKey as QueryKey | undefined, 'execute');
      void invalidateThenRefetchInner(payload.filters, payload.opts);
    }
  }, DEBOUNCE_MS);
  pendingDebounceTimers.set(debounceKey, timer);
}

/** Invalida listagem/agregados de colaboradores (pós-create/update em RH). */
export function invalidateEmployeesQueries(tenantId: string, opts: MutationInvalidationOpts = defaultMutationOpts): void {
  if (!tenantId) return;
  scheduleOrRunInvalidateThenRefetch({ queryKey: ['employees', tenantId] }, opts);
}

/** Invalida dados de espelho para um colaborador/mês (pós-ponto ou sync). */
export function invalidateTimesheetQueries(
  tenantId: string,
  userId: string,
  monthYyyyMm?: string,
  opts: MutationInvalidationOpts = defaultMutationOpts,
): void {
  if (!tenantId || !userId) return;
  if (monthYyyyMm) {
    const k = apiQueryKeys.timesheet(tenantId, userId, monthYyyyMm);
    scheduleOrRunInvalidateThenRefetch({ queryKey: k }, opts);
    return;
  }
  scheduleOrRunInvalidateThenRefetch({ queryKey: ['timesheet', tenantId, userId] }, opts);
}

/** Painel / resumos (pós-batida ou alteração de saldo). */
export function invalidateDashboardQueries(
  tenantId: string,
  userId: string,
  opts: MutationInvalidationOpts = defaultMutationOpts,
): void {
  if (!tenantId || !userId) return;
  const k = apiQueryKeys.dashboard(tenantId, userId);
  scheduleOrRunInvalidateThenRefetch({ queryKey: k }, opts);
}

/** Todas as queries de painel do tenant (prefix match). */
export function invalidateDashboardQueriesForCompany(
  tenantId: string,
  opts: MutationInvalidationOpts = defaultMutationOpts,
): void {
  if (!tenantId) return;
  scheduleOrRunInvalidateThenRefetch({ queryKey: ['dashboard', tenantId] }, opts);
}

export function invalidateRepPendingQueries(tenantId: string, opts: MutationInvalidationOpts = defaultMutationOpts): void {
  if (!tenantId) return;
  const k = apiQueryKeys.repPending(tenantId);
  scheduleOrRunInvalidateThenRefetch({ queryKey: k }, opts);
  scheduleOrRunInvalidateThenRefetch({ queryKey: apiQueryKeys.operationalStatus(tenantId) }, opts);
}

/** Painel de status operacional por dia (pós-batida / sync REP / reconciliação). */
export function invalidateOperationalStatusQueries(tenantId: string, opts: MutationInvalidationOpts = defaultMutationOpts): void {
  if (!tenantId) return;
  const forced: MutationInvalidationOpts = { ...opts, force: true };
  scheduleOrRunInvalidateThenRefetch({ queryKey: apiQueryKeys.operationalStatus(tenantId) }, forced);
  scheduleOrRunInvalidateThenRefetch({ queryKey: apiQueryKeys.operationalAlerts(tenantId) }, forced);
  scheduleOrRunInvalidateThenRefetch({ queryKey: apiQueryKeys.operationalTasks(tenantId) }, forced);
  scheduleOrRunInvalidateThenRefetch({ queryKey: apiQueryKeys.operationalRisk(tenantId) }, forced);
  scheduleOrRunInvalidateThenRefetch({ queryKey: apiQueryKeys.operationalAudit(tenantId) }, forced);
  scheduleOrRunInvalidateThenRefetch({ queryKey: ['operational-timeline', tenantId] }, forced);
}

/** Após registrar ponto: espelho + dashboard do utilizador. */
export function invalidatePunchRelatedReactQueries(
  tenantId: string | undefined,
  userId: string,
  monthYyyyMm?: string,
  opts: MutationInvalidationOpts = defaultMutationOpts,
): void {
  if (!tenantId) return;
  invalidateTimesheetQueries(tenantId, userId, monthYyyyMm, opts);
  invalidateDashboardQueries(tenantId, userId, opts);
}
