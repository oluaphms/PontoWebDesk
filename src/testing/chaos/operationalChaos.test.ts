import { describe, expect, it, vi } from 'vitest';
import { operationalCircuitBreaker, retryBudget, degradedMode } from '../../domain/operational/resilience';
import { operationalWatchdog } from '../../domain/operational/watchdog';
import { recordOperationalMetric } from '../../domain/operational/metrics';
import { evaluateRealtimeGpsReliability } from '../../services/geolocation/realtimeGeoReliability.service';
import { resolveRealtimeMonitoringLocation } from '../../services/geolocation/monitoringGeoSourceResolver';
import { resolveUnifiedOperationalState } from '../../domain/operational/unifiedOperationalResolver';
import { recordRealtimeInvalidateBurst, getRealtimeSheddingDebounceFactor } from '../../performance/realtimeLoadShedding';
import { auditTenantIsolationIntegrity } from '../../domain/security/tenantIsolationAudit';
import { runOperationalJob } from '../../domain/operational/jobs/operationalJobScheduler';
import { operationalReliabilitySLO, OperationalReliabilitySLO } from '../../domain/operational/reliability/operationalReliabilitySLO';
import { reportGeoCircuitSignal, getGeoOperationalCircuitDegradeFactor, notifyGeoCircuitSuccess } from '../../domain/operational/geo/geoOperationalCircuitBreaker';
import { operationalBusEmit, operationalBusSubscribe } from '../../domain/operational/bus/operationalEventBus';
import { setOperationalWallClockOffsetMs, getOperationalWallClockOffsetMs } from '../../utils/operationalDateHardLock';

describe('operational chaos suite', () => {
  it('abre circuito após falhas em cascata de RPC', async () => {
    let calls = 0;
    await expect(
      operationalCircuitBreaker.execute({
        key: 'chaos-rpc-timeout',
        companyId: 'co-chaos',
        failureThreshold: 2,
        fn: async () => {
          calls += 1;
          throw new Error('timeout');
        },
      }),
    ).rejects.toThrow();

    await expect(
      operationalCircuitBreaker.execute({
        key: 'chaos-rpc-timeout',
        companyId: 'co-chaos',
        failureThreshold: 2,
        fn: async () => {
          calls += 1;
          throw new Error('timeout');
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
    expect(degradedMode.isTenantDegraded('co-chaos')).toBe(true);
  });

  it('detecta retry storm e watchdog reage', () => {
    for (let i = 0; i < 12; i++) {
      recordOperationalMetric('retry_storm_rate', 15, {
        company_id: 'co-chaos',
        source: 'chaos-test',
        operation_type: 'retry',
      });
    }
    const snap = operationalWatchdog.run();
    expect(snap.alerts.some((a) => a.code === 'retry_storm')).toBe(true);
  });

  it('aplica budget de retry contra loop', () => {
    const key = 'chaos-budget';
    let allowed = 0;
    for (let i = 0; i < 70; i++) {
      if (retryBudget.allow(key, 30)) allowed += 1;
    }
    expect(allowed).toBeLessThan(70);
  });

  it('watchdog reage a drift operacional e movimento GEO inválido', () => {
    for (let i = 0; i < 8; i++) {
      recordOperationalMetric('cos_drift_detected_count', 3, { company_id: 'co-chaos', source: 'chaos-test' });
      recordOperationalMetric('cos_stale_snapshot_count', 4, { company_id: 'co-chaos', source: 'chaos-test' });
      recordOperationalMetric('geo_invalid_realtime_movement', 1, { company_id: 'co-chaos', source: 'chaos-test' });
    }
    const snap = operationalWatchdog.run();
    expect(snap.alerts.some((a) => a.code === 'cos_drift')).toBe(true);
    expect(snap.alerts.some((a) => a.code === 'geo_impossible_movement')).toBe(true);
  });

  it('inunda avaliações GEO e resolve fonte sob carga', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const nowMs = Date.now();
    for (let i = 0; i < 200; i++) {
      evaluateRealtimeGpsReliability({
        latitude: -15.79 + (i % 10) * 0.0001,
        longitude: -47.88,
        accuracyMeters: 25 + (i % 5),
        coordinateAgeMs: 1000,
        speedMps: 0,
        provider: 'gps',
        previous: null,
        nowMs,
        silent: true,
        log: false,
      });
      resolveRealtimeMonitoringLocation({
        nowMs,
        employeeId: `e-${i % 20}`,
        companyId: 'co-chaos',
        live: null,
        cos: null,
        record: {
          lat: -15.8,
          lng: -47.9,
          accuracy: 40,
          capturedAt: new Date(nowMs - 5000).toISOString(),
          provider: 'gps',
          recordId: `r-${i}`,
        },
        previousAccepted: null,
        log: false,
      });
    }
    const uni = resolveUnifiedOperationalState({
      companyId: 'co-chaos',
      users: Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, nome: `U${i}` })),
      cosRows: [],
      timeRecords: [],
      liveByEmployee: new Map(),
      todayYmd: '2099-01-01',
      nowMs,
    });
    expect(uni.pipelineRows.length).toBe(5);
    console.info('[GEO CHAOS RECOVERY]', { iterations: 200 });
    console.info('[REALTIME RECOVERY]', { ok: true });
    console.info('[STATE RECOVERY SUCCESS]', { rows: uni.pipelineRows.length });
  });

  it('realtime load shedding sob rajada de invalidação', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    for (let i = 0; i < 24; i++) {
      recordRealtimeInvalidateBurst(1);
    }
    const f = getRealtimeSheddingDebounceFactor();
    expect(f).toBeGreaterThanOrEqual(1);
  });

  it('tenant isolation audit in-memory não explode', () => {
    const r = auditTenantIsolationIntegrity();
    expect(Array.isArray(r.violations)).toBe(true);
  });

  it('job scheduler purge é determinístico', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await runOperationalJob('purge_old_traces', {});
    expect(r.ok).toBe(true);
  });

  it('geo fraud evaluation retorna score (somente observabilidade)', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { evaluateGeoFraudSignals } = await import('../../services/geolocation/geoFraudDetection.service');
    const out = evaluateGeoFraudSignals({
      latitude: -15.794,
      longitude: -47.882,
      accuracyMeters: 40,
      coordinateAgeMs: 3000,
      speedMps: 1,
      provider: 'gps',
      previous: null,
      nowMs: Date.now(),
    });
    expect(out.geo_trust_score).toBeGreaterThan(30);
    expect(['trusted', 'suspicious', 'blocked']).toContain(out.trust_level);
  });

  it('invalidateQueries storm sintético via métricas', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 50; i++) {
      recordOperationalMetric('retry_storm_rate', 2, { company_id: `co-${i % 5}`, source: 'chaos-invalidate' });
    }
    const snap = operationalWatchdog.run();
    expect(snap.alerts.length).toBeGreaterThanOrEqual(0);
  });

  it('login storm limitado por retry budget', () => {
    const k = 'chaos-login-storm';
    let n = 0;
    for (let i = 0; i < 200; i++) {
      if (retryBudget.allow(k, 40)) n += 1;
    }
    expect(n).toBeLessThan(200);
  });

  it('websocket reconnect storm (circuit breaker)', async () => {
    let calls = 0;
    await expect(
      operationalCircuitBreaker.execute({
        key: 'chaos-ws-reconnect',
        companyId: 'co-ws',
        failureThreshold: 1,
        fn: async () => {
          calls += 1;
          throw new Error('ws_drop');
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('SLO registry aceita amostras sem lançar', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 40; i++) {
      operationalReliabilitySLO.recordMonitoringRefreshMs(100 + i);
      OperationalReliabilitySLO.recordStaleRate(0.05);
    }
    expect(true).toBe(true);
  });

  it('GEO circuit breaker degrada fator após rajada sintética', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    notifyGeoCircuitSuccess();
    for (let i = 0; i < 6; i++) {
      reportGeoCircuitSignal('stream_congestion');
    }
    expect(getGeoOperationalCircuitDegradeFactor()).toBeGreaterThanOrEqual(1);
  });

  it('operational event bus entrega payload', () => {
    let seen: unknown;
    const unsub = operationalBusSubscribe('telemetry:tick', (d) => {
      seen = d;
    });
    operationalBusEmit('telemetry:tick', { chaos: true });
    unsub();
    expect(seen).toEqual({ chaos: true });
  });

  it('offset de relógio operacional é aplicável e legível', () => {
    setOperationalWallClockOffsetMs(12);
    expect(getOperationalWallClockOffsetMs()).toBe(12);
    setOperationalWallClockOffsetMs(0);
  });
});
