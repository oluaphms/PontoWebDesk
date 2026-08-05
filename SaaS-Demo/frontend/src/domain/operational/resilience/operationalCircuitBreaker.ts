import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
import { operationalLog } from '../observability';
import { recordOperationalMetric } from '../metrics/operationalMetrics';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

type CircuitEntry = {
  key: string;
  state: CircuitState;
  failures: number;
  opened_at: number | null;
  half_open_trials: number;
};

const CIRCUITS = new Map<string, CircuitEntry>();
const DEGRADED_TENANTS = new Set<string>();
const RETRY_COUNTER = new Map<
  string,
  { count: number; windowStart: number; /** Evita spam de log quando o budget nega em loop no mesmo minuto. */ stormAnnounced?: boolean }
>();

function getCircuit(key: string): CircuitEntry {
  const current = CIRCUITS.get(key);
  if (current) return current;
  const created: CircuitEntry = {
    key,
    state: 'CLOSED',
    failures: 0,
    opened_at: null,
    half_open_trials: 0,
  };
  CIRCUITS.set(key, created);
  return created;
}

export const retryBackoff = {
  computeDelayMs(attempt: number, baseMs = 250, maxMs = 8_000): number {
    const expo = baseMs * 2 ** Math.max(0, attempt - 1);
    const jitter = Math.floor(Math.random() * Math.min(1000, baseMs));
    return Math.min(maxMs, expo + jitter);
  },
};

export const retryBudget = {
  allow(key: string, maxRetriesPerMinute = 60): boolean {
    const now = Date.now();
    const current = RETRY_COUNTER.get(key);
    if (!current || now - current.windowStart > 60_000) {
      RETRY_COUNTER.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (current.count >= maxRetriesPerMinute) {
      if (!current.stormAnnounced) {
        current.stormAnnounced = true;
        operationalLog('RECOVERY', {
          severity: 'warning',
          event_type: 'retry_storm_detected',
          source: 'retryBudget',
          lifecycle: 'protection',
          retry_key: key,
          retries_in_window: current.count,
        });
        observabilityConsole.warn('[RETRY STORM]', { key, retries_in_window: current.count });
        recordOperationalMetric('retry_storm_rate', current.count, { source: 'retryBudget' });
      }
      return false;
    }
    current.count += 1;
    return true;
  },
};

export const degradedMode = {
  markTenant(companyId: string): void {
    if (!companyId) return;
    DEGRADED_TENANTS.add(companyId);
    operationalLog('HEALTH', {
      company_id: companyId,
      severity: 'warning',
      source: 'degradedMode',
      lifecycle: 'degraded',
      event_type: 'tenant_marked_degraded',
    });
    observabilityConsole.warn('[DEGRADED MODE]', { company_id: companyId });
  },
  clearTenant(companyId: string): void {
    if (!companyId) return;
    DEGRADED_TENANTS.delete(companyId);
  },
  isTenantDegraded(companyId: string): boolean {
    return DEGRADED_TENANTS.has(companyId);
  },
  listDegradedTenants(): string[] {
    return Array.from(DEGRADED_TENANTS.values());
  },
};

export const operationalCircuitBreaker = {
  async execute<T>(input: {
    key: string;
    companyId?: string | null;
    failureThreshold?: number;
    resetTimeoutMs?: number;
    halfOpenSuccesses?: number;
    fn: () => Promise<T>;
  }): Promise<T> {
    const key = input.key;
    const failureThreshold = input.failureThreshold ?? 4;
    const resetTimeoutMs = input.resetTimeoutMs ?? 15_000;
    const halfOpenSuccesses = input.halfOpenSuccesses ?? 2;
    const circuit = getCircuit(key);
    const now = Date.now();

    if (circuit.state === 'OPEN') {
      const elapsed = now - (circuit.opened_at ?? now);
      if (elapsed < resetTimeoutMs) {
        observabilityConsole.warn('[CIRCUIT OPEN]', { key, remaining_ms: resetTimeoutMs - elapsed });
        throw new Error(`Circuito aberto para ${key}`);
      }
      circuit.state = 'HALF_OPEN';
      circuit.half_open_trials = 0;
      observabilityConsole.info('[CIRCUIT HALF_OPEN]', { key });
    }

    try {
      const result = await input.fn();
      if (circuit.state === 'HALF_OPEN') {
        circuit.half_open_trials += 1;
        if (circuit.half_open_trials >= halfOpenSuccesses) {
          circuit.state = 'CLOSED';
          circuit.failures = 0;
          circuit.opened_at = null;
        }
      } else {
        circuit.failures = 0;
      }
      return result;
    } catch (error) {
      circuit.failures += 1;
      if (circuit.failures >= failureThreshold) {
        circuit.state = 'OPEN';
        circuit.opened_at = Date.now();
        observabilityConsole.warn('[CIRCUIT OPEN]', { key, failures: circuit.failures });
        operationalLog('RECOVERY', {
          company_id: input.companyId ?? null,
          severity: 'error',
          source: 'operationalCircuitBreaker',
          lifecycle: 'protection',
          event_type: 'circuit_open',
          circuit_key: key,
          failures: circuit.failures,
        });
        recordOperationalMetric('circuit_breaker_activations', 1, {
          company_id: input.companyId ?? null,
          source: 'operationalCircuitBreaker',
          operation_type: key,
        });
        if (input.companyId) degradedMode.markTenant(input.companyId);
      }
      throw error;
    }
  },
};
