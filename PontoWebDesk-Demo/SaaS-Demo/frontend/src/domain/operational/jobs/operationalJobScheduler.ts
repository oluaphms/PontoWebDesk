import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
/**
 * Agendador operacional in-process: lock, timeout, budget, circuit breaker.
 * Não substitui filas server-side; serve para orquestração determinística no cliente/admin.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { operationalCircuitBreaker, retryBudget } from '../resilience';
import { operationalNowUtcIso } from '../../../utils/operationalDateHardLock';

export type OperationalJobId =
  | 'current_state_self_heal'
  | 'scheduled_operational_geo_reconciliation'
  | 'cleanup_live_locations'
  | 'purge_old_traces'
  | 'purge_old_metrics'
  | 'geo_consistency_audit'
  | 'replay_drift_audit'
  | 'tenant_cache_cleanup';

export type OperationalJobContext = {
  supabaseClient?: SupabaseClient;
  companyId?: string;
  /** Escopo opcional para limpeza de cache tenant-aware. */
  tenantScope?: { companyId?: string; userId?: string };
};

type JobDef = {
  timeoutMs: number;
  concurrencyKey: (id: OperationalJobId) => string;
  retryBudgetKey: string;
  circuitKey: string;
  run: (ctx: OperationalJobContext, signal: AbortSignal) => Promise<void>;
};

const REGISTRY = new Map<OperationalJobId, JobDef>();
const LOCKS = new Map<string, number>();
const ACTIVE_ABORT = new Map<string, AbortController>();

type LastRun = { at: string; ok: boolean; error?: string };
const LAST_RUN = new Map<OperationalJobId, LastRun>();

function lockKeyFor(id: OperationalJobId): string {
  const def = REGISTRY.get(id);
  return def ? def.concurrencyKey(id) : id;
}

export function registerOperationalJob(id: OperationalJobId, def: JobDef): void {
  REGISTRY.set(id, def);
}

export function listOperationalJobs(): Array<{
  id: OperationalJobId;
  timeoutMs: number;
  circuitKey: string;
  lastRun: LastRun | null;
  locked: boolean;
}> {
  const out: Array<{
    id: OperationalJobId;
    timeoutMs: number;
    circuitKey: string;
    lastRun: LastRun | null;
    locked: boolean;
  }> = [];
  for (const [id, def] of REGISTRY.entries()) {
    const lk = def.concurrencyKey(id);
    out.push({
      id,
      timeoutMs: def.timeoutMs,
      circuitKey: def.circuitKey,
      lastRun: LAST_RUN.get(id) ?? null,
      locked: LOCKS.has(lk),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function getOperationalJobHealth(): {
  jobs_registered: number;
  active_locks: number;
  jobs: ReturnType<typeof listOperationalJobs>;
} {
  return {
    jobs_registered: REGISTRY.size,
    active_locks: LOCKS.size,
    jobs: listOperationalJobs(),
  };
}

export function cancelOperationalJob(id: OperationalJobId): boolean {
  const lk = lockKeyFor(id);
  const ac = ACTIVE_ABORT.get(lk);
  if (!ac) return false;
  ac.abort();
  return true;
}

export async function runOperationalJob(
  id: OperationalJobId,
  ctx: OperationalJobContext = {},
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const def = REGISTRY.get(id);
  if (!def) {
    observabilityConsole.warn('[JOB FAILED]', { job: id, reason: 'unknown_job' });
    return { ok: false, error: 'unknown_job' };
  }

  const lk = def.concurrencyKey(id);
  if (LOCKS.has(lk)) {
    observabilityConsole.info('[JOB CONCURRENCY BLOCKED]', { job: id, lock: lk });
    return { ok: false, error: 'concurrency_blocked' };
  }

  if (!retryBudget.allow(def.retryBudgetKey, 45)) {
    observabilityConsole.info('[JOB SKIPPED]', { job: id, reason: 'retry_budget' });
    return { ok: false, skipped: true, error: 'retry_budget' };
  }

  const ac = new AbortController();
  LOCKS.set(lk, Date.now());
  ACTIVE_ABORT.set(lk, ac);
  observabilityConsole.info('[JOB START]', { job: id, at: operationalNowUtcIso() });

  const runWithTimeout = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('job_timeout')), def.timeoutMs);
      def
        .run(ctx, ac.signal)
        .then(() => {
          clearTimeout(t);
          resolve();
        })
        .catch((e) => {
          clearTimeout(t);
          reject(e);
        });
    });

  try {
    await operationalCircuitBreaker.execute({
      key: def.circuitKey,
      companyId: ctx.companyId ?? null,
      fn: () => runWithTimeout(),
    });
    observabilityConsole.info('[JOB SUCCESS]', { job: id });
    LAST_RUN.set(id, { at: operationalNowUtcIso(), ok: true });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'job_timeout') {
      observabilityConsole.warn('[JOB TIMEOUT]', { job: id, timeout_ms: def.timeoutMs });
    } else {
      observabilityConsole.warn('[JOB FAILED]', { job: id, error: msg });
    }
    LAST_RUN.set(id, { at: operationalNowUtcIso(), ok: false, error: msg });
    return { ok: false, error: msg };
  } finally {
    LOCKS.delete(lk);
    ACTIVE_ABORT.delete(lk);
  }
}

let DEFAULT_JOBS_REGISTERED = false;
function bootstrapDefaultOperationalJobs(): void {
  if (DEFAULT_JOBS_REGISTERED) return;
  DEFAULT_JOBS_REGISTERED = true;

  registerOperationalJob('purge_old_traces', {
    timeoutMs: 15_000,
    concurrencyKey: () => 'purge_traces',
    retryBudgetKey: 'job:purge_old_traces',
    circuitKey: 'circuit:purge_old_traces',
    run: async () => {
      const { purgeOldOperationalTraces } = await import('../tracing');
      purgeOldOperationalTraces();
    },
  });

  registerOperationalJob('purge_old_metrics', {
    timeoutMs: 15_000,
    concurrencyKey: () => 'purge_metrics',
    retryBudgetKey: 'job:purge_old_metrics',
    circuitKey: 'circuit:purge_old_metrics',
    run: async () => {
      const { purgeOldOperationalMetrics } = await import('../metrics/operationalMetrics');
      purgeOldOperationalMetrics();
    },
  });

  registerOperationalJob('cleanup_live_locations', {
    timeoutMs: 60_000,
    concurrencyKey: () => 'cleanup_live',
    retryBudgetKey: 'job:cleanup_live_locations',
    circuitKey: 'circuit:cleanup_live_locations',
    run: async (ctx) => {
      if (!ctx.supabaseClient) {
        observabilityConsole.info('[JOB SKIPPED]', { job: 'cleanup_live_locations', reason: 'no_client' });
        return;
      }
      const { runLiveLocationCleanup } = await import('../../../services/liveEmployeeLocation.service');
      await runLiveLocationCleanup(ctx.supabaseClient);
    },
  });

  registerOperationalJob('current_state_self_heal', {
    timeoutMs: 120_000,
    concurrencyKey: () => 'cos_self_heal',
    retryBudgetKey: 'job:current_state_self_heal',
    circuitKey: 'circuit:current_state_self_heal',
    run: async (ctx) => {
      if (!ctx.supabaseClient || !ctx.companyId) {
        observabilityConsole.info('[JOB SKIPPED]', { job: 'current_state_self_heal', reason: 'missing_company_or_client' });
        return;
      }
      const { runOperationalStateSelfHeal } = await import('../operationalStateSelfHealing');
      await runOperationalStateSelfHeal(ctx.supabaseClient, ctx.companyId);
    },
  });

  registerOperationalJob('scheduled_operational_geo_reconciliation', {
    timeoutMs: 180_000,
    concurrencyKey: () => 'scheduled_geo_recon',
    retryBudgetKey: 'job:scheduled_operational_geo_reconciliation',
    circuitKey: 'circuit:scheduled_operational_geo_reconciliation',
    run: async (ctx) => {
      if (!ctx.supabaseClient || !ctx.companyId) {
        observabilityConsole.info('[JOB SKIPPED]', { job: 'scheduled_operational_geo_reconciliation', reason: 'missing_company_or_client' });
        return;
      }
      const { scheduledOperationalGeoReconciliation } = await import('../reconciliation/scheduledOperationalGeoReconciliation');
      await scheduledOperationalGeoReconciliation({ client: ctx.supabaseClient, companyId: ctx.companyId });
    },
  });

  registerOperationalJob('geo_consistency_audit', {
    timeoutMs: 20_000,
    concurrencyKey: () => 'geo_audit',
    retryBudgetKey: 'job:geo_consistency_audit',
    circuitKey: 'circuit:geo_consistency_audit',
    run: async () => {
      const { summarizeOperationalMetrics } = await import('../metrics/operationalMetrics');
      const { recordOperationalMetric } = await import('../metrics/operationalMetrics');
      const sums = summarizeOperationalMetrics();
      const geo = sums.filter((s) => s.name.startsWith('geo_'));
      const teleport = sums.find((s) => s.name === 'geo_teleport_detected');
      if (teleport && teleport.p95 > 2) {
        observabilityConsole.info('[JOB SUCCESS]', { job: 'geo_consistency_audit', note: 'teleport_pressure', p95: teleport.p95 });
      }
      recordOperationalMetric('geo_reliability_eval', geo.length, { source: 'job_geo_audit' });
    },
  });

  registerOperationalJob('replay_drift_audit', {
    timeoutMs: 20_000,
    concurrencyKey: () => 'replay_audit',
    retryBudgetKey: 'job:replay_drift_audit',
    circuitKey: 'circuit:replay_drift_audit',
    run: async () => {
      const { summarizeOperationalMetrics } = await import('../metrics/operationalMetrics');
      const { recordOperationalMetric } = await import('../metrics/operationalMetrics');
      const replay = summarizeOperationalMetrics('replay_duration_ms')[0];
      if (replay && replay.p99 > 12_000) {
        observabilityConsole.info('[RECONCILIATION DRIFT]', { kind: 'replay_slow', p99: replay.p99 });
      }
      recordOperationalMetric('replay_throughput', replay?.count ?? 0, { source: 'replay_drift_audit' });
    },
  });

  registerOperationalJob('tenant_cache_cleanup', {
    timeoutMs: 30_000,
    concurrencyKey: () => 'tenant_cache',
    retryBudgetKey: 'job:tenant_cache_cleanup',
    circuitKey: 'circuit:tenant_cache_cleanup',
    run: async (ctx) => {
      const { clearTenantScopedCaches } = await import('../cache/tenantCacheIsolation');
      if (ctx.tenantScope?.companyId || ctx.tenantScope?.userId) {
        clearTenantScopedCaches(ctx.tenantScope);
      } else {
        observabilityConsole.info('[JOB SKIPPED]', { job: 'tenant_cache_cleanup', reason: 'no_scope_full_clear_skipped' });
      }
    },
  });
}

bootstrapDefaultOperationalJobs();
