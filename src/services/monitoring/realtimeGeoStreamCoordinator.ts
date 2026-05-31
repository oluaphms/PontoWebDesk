import { observabilityConsole } from '../../shared/logger/observabilityConsole';
/**
 * Coordena entregas realtime do mapa: coalesce, debounce, backpressure por visibilidade.
 */

import { getMonitoringRealtimeDebounceMs, isPollingSuppressedByVisibility } from '../../performance/pollingGovernor';
import { reportDeviceOperationalReputationFromMonitoringContext } from '../deviceOperationalReputation.service';
import { operationalReliabilitySLO } from '../../domain/operational/reliability/operationalReliabilitySLO';
import { reportGeoCircuitSignal } from '../../domain/operational/geo/geoOperationalCircuitBreaker';
import { operationalBusEmit } from '../../domain/operational/bus/operationalEventBus';
import { getOperationalFeatureFlags } from '../../domain/operational/governance/operationalFeatureFlags';
import { getOperationalFeatureFlag } from '../../config/operationalFeatureFlags';
import { resolveOperationalRollout } from '../operationalRollout.service';

type FlushFn = () => void;

class RealtimeGeoStreamCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private coalesced = 0;
  private latestByEmployee = new Map<
    string,
    { version: number; updatedAt: string; capturedAt: string | null; checksum: string | null; lineage: string | null }
  >();

  constructor(private readonly companyId: string) {}

  requestFlush(reason: string, flush: FlushFn): void {
    const coordinatorEnabled =
      getOperationalFeatureFlags().streamCoordinator &&
      getOperationalFeatureFlag('realtimeCoordinator', { companyId: this.companyId }) &&
      resolveOperationalRollout({ featureName: 'realtimeCoordinator', companyId: this.companyId, percentage: 100 });
    if (!coordinatorEnabled) {
      if (!isPollingSuppressedByVisibility()) {
        observabilityConsole.info('[REALTIME GEO STREAM]', { company_id: this.companyId, action: 'flush_immediate', reason });
        flush();
      }
      return;
    }
    if (this.timer) {
      this.coalesced++;
      observabilityConsole.info('[STREAM COALESCED]', { company_id: this.companyId, reason, coalesced: this.coalesced });
    }
    if (this.timer) clearTimeout(this.timer);

    let base = getMonitoringRealtimeDebounceMs();
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      base = Math.round(base * 1.35);
      if (this.coalesced > 6) {
        observabilityConsole.warn('[STREAM BACKPRESSURE]', { company_id: this.companyId, coalesced: this.coalesced });
        operationalReliabilitySLO.recordRealtimeCoalescePeak(this.coalesced);
        reportGeoCircuitSignal('realtime_lag');
        operationalBusEmit('realtime:flush', { companyId: this.companyId, coalesced: this.coalesced });
        if (this.coalesced > 8) {
          reportDeviceOperationalReputationFromMonitoringContext('realtime_backpressure');
        }
        base = Math.round(base * 1.5);
      }
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.coalesced = 0;
      if (isPollingSuppressedByVisibility()) {
        observabilityConsole.info('[REALTIME GEO STREAM]', { company_id: this.companyId, action: 'skipped_visibility' });
        return;
      }
      observabilityConsole.info('[REALTIME GEO STREAM]', { company_id: this.companyId, action: 'flush', reason });
      flush();
    }, base);
  }

  shouldApplyRealtimeEvent(input: {
    employeeId: string;
    version?: number | null;
    updatedAt?: string | null;
    capturedAt?: string | null;
    checksum?: string | null;
    lineage?: string | null;
  }): boolean {
    const key = input.employeeId;
    const prev = this.latestByEmployee.get(key);
    const next = {
      version: Number(input.version ?? 0),
      updatedAt: String(input.updatedAt ?? ''),
      capturedAt: input.capturedAt ?? null,
      checksum: input.checksum ?? null,
      lineage: input.lineage ?? null,
    };
    if (prev) {
      if (next.version < prev.version || (next.updatedAt && prev.updatedAt && next.updatedAt < prev.updatedAt)) {
        observabilityConsole.warn('[REALTIME REGRESSION BLOCKED]', { employee_id: key, prev, next });
        return false;
      }
      if (next.capturedAt && prev.capturedAt && next.capturedAt < prev.capturedAt) {
        observabilityConsole.warn('[REALTIME STALE EVENT DROPPED]', { employee_id: key, reason: 'captured_at_regression' });
        return false;
      }
      if (next.lineage && prev.lineage && next.lineage < prev.lineage) {
        observabilityConsole.warn('[REALTIME STALE EVENT DROPPED]', { employee_id: key, reason: 'lineage_regression' });
        return false;
      }
      if (next.checksum && prev.checksum && next.checksum !== prev.checksum && next.version <= prev.version) {
        observabilityConsole.warn('[REALTIME REGRESSION BLOCKED]', { employee_id: key, reason: 'checksum_non_monotonic' });
        return false;
      }
    }
    this.latestByEmployee.set(key, next);
    return true;
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.coalesced = 0;
    this.latestByEmployee.clear();
  }
}

const byCompany = new Map<string, RealtimeGeoStreamCoordinator>();

export function getRealtimeGeoStreamCoordinator(companyId: string): RealtimeGeoStreamCoordinator {
  let c = byCompany.get(companyId);
  if (!c) {
    c = new RealtimeGeoStreamCoordinator(companyId);
    byCompany.set(companyId, c);
  }
  return c;
}

export function releaseRealtimeGeoStreamCoordinator(companyId: string): void {
  const c = byCompany.get(companyId);
  if (c) {
    c.cancel();
    byCompany.delete(companyId);
  }
}

/** Nome de classe exportado para consumo explícito nos módulos de mapa. */
export { RealtimeGeoStreamCoordinator };
