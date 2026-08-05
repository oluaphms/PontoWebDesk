import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { QueryClient } from '@tanstack/react-query';
import { patchQueryClientInvalidationAudit } from '../performance/queryInvalidationAudit';
import { patchQueryCostGuard } from '../performance/queryCostGuard';
import { IS_DEV } from '../config/runtimeEnv';

function patchQueryClientDevCacheHitLogger(queryClient: QueryClient): void {
  if (!IS_DEV || typeof console === 'undefined') return;

  const allowedHeads = new Set(['employees', 'timesheet', 'dashboard', 'rep-pending', 'records']);
  const lastHitLog = new Map<string, number>();

  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const q = event.query;
    const action = (event as { action?: { type?: string } }).action;
    if (action?.type !== 'observerResultsUpdated') return;
    if (q.state.fetchStatus !== 'idle' || q.state.status !== 'success') return;

    const head = Array.isArray(q.queryKey) ? q.queryKey[0] : undefined;
    if (typeof head !== 'string' || !allowedHeads.has(head)) return;

    const id = JSON.stringify(q.queryKey);
    const now = Date.now();
    if ((lastHitLog.get(id) ?? 0) + 500 > now) return;
    lastHitLog.set(id, now);
    observabilityConsole.info('[CACHE HIT]', { queryKey: q.queryKey });
  });
}

/**
 * QueryClient Configuration
 *
 * Padrão produção: dados fresh 30s, retenção em memória 5 min, sem refetch ao focar janela.
 * Retentativas: até 2 para erros de rede/5xx (não retenta em 4xx de cliente).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: (failureCount, error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (/401|403|404/.test(msg)) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    },
    mutations: {
      retry: (failureCount, error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (/401|403|404/.test(msg)) return false;
        return failureCount < 2;
      },
    },
  },
});

patchQueryClientInvalidationAudit(queryClient);
patchQueryCostGuard(queryClient);
patchQueryClientDevCacheHitLogger(queryClient);
