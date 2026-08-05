import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
/**
 * Reconciliação do snapshot `current_operational_state` vs `time_records` (auditoria + repair).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchCurrentOperationalStateByCompany,
  parseOperationalStatusEnum,
  refreshCurrentOperationalStateRpc,
} from '../../../services/currentOperationalState.service';
import { listTimeRecords } from '../../../../services/timeRecords.service';
import {
  EmployeeOperationalStatus,
  computeRealtimeOperationalStatusFromTypeAndAge,
  MONITORING_OFFLINE_AFTER_LAST_PUNCH_MS,
} from '../../../types/employeeOperationalStatus';
import {
  validateOperationalTimestamp,
  type OperationalPunchRecord,
} from '../../../services/monitoring/monitoringGeoHardLock.service';
import { recordPunchInstantIso, recordPunchInstantMs } from '../../../utils/punchOrigin';
import { recordOperationalMetric } from '../metrics/operationalMetrics';
import { createOperationalCorrelationId } from '../correlationId';
import { runLiveLocationCleanup } from '../../../services/liveEmployeeLocation.service';
import { normalizeOperationalDate, operationalNowUtcIso } from '../../../utils/operationalDateHardLock';

export type OperationalStateIntegrityReport = {
  drift_count: number;
  stale_snapshot_count: number;
  orphan_snapshot_count: number;
  details: Array<{
    employee_id: string;
    kind: 'status' | 'timestamp' | 'geo' | 'offline' | 'orphan' | 'missing_punch';
    message: string;
  }>;
};

function lastValidPunchForUser(records: OperationalPunchRecord[], userId: string, nowMs: number): OperationalPunchRecord | null {
  const valid = records.filter(
    (r) => r.user_id === userId && validateOperationalTimestamp(recordPunchInstantIso(r), nowMs).ok,
  );
  if (valid.length === 0) return null;
  valid.sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
  return valid[0] ?? null;
}

function expectedStatusFromLast(
  last: OperationalPunchRecord | null,
  userRaw: OperationalPunchRecord[],
  nowMs: number,
): EmployeeOperationalStatus {
  if (!last) {
    const hasAny = userRaw.length > 0;
    return computeRealtimeOperationalStatusFromTypeAndAge(
      null,
      MONITORING_OFFLINE_AFTER_LAST_PUNCH_MS + 1,
      true,
      hasAny,
    );
  }
  const v = validateOperationalTimestamp(recordPunchInstantIso(last), nowMs);
  const ageMs = v.ok ? nowMs - v.instantMs : MONITORING_OFFLINE_AFTER_LAST_PUNCH_MS + 1;
  return computeRealtimeOperationalStatusFromTypeAndAge(last.type, ageMs, false, userRaw.length > 0);
}

/** Recalcula snapshots com force + limpeza de live location. */
export async function reconcileCurrentOperationalState(
  client: SupabaseClient,
  companyId: string,
  employeeIds?: string[],
  correlationId: string = createOperationalCorrelationId(),
): Promise<{ refreshed: number; cleanup_removed: number }> {
  const cos = await fetchCurrentOperationalStateByCompany(companyId, client);
  const ids = employeeIds?.length
    ? employeeIds
    : Array.from(new Set(cos.map((r) => r.employee_id)));
  let refreshed = 0;
  for (const emp of ids) {
    const r = await refreshCurrentOperationalStateRpc(companyId, emp, {
      source: 'reconciliation',
      eventAt: operationalNowUtcIso(),
      force: true,
      correlationId,
      client,
    });
    if (r.ok) refreshed += 1;
  }
  const cleanup_removed = await runLiveLocationCleanup(client);
  observabilityConsole.info('[CURRENT STATE RECONCILIATION]', {
    company_id: companyId,
    correlation_id: correlationId,
    refreshed,
    cleanup_removed,
    state_source: 'reconciliation',
  });
  recordOperationalMetric('cos_reconciliation_runs', refreshed, { company_id: companyId, source: 'reconciler' });
  return { refreshed, cleanup_removed };
}

/** Detecta divergências sem gravar (comparando com amostra recente de time_records). */
export async function auditCurrentOperationalStateIntegrity(
  client: SupabaseClient,
  companyId: string,
  recordLimit = 1200,
): Promise<OperationalStateIntegrityReport> {
  const nowMs = Date.now();
  const cosRows = await fetchCurrentOperationalStateByCompany(companyId, client);
  const records = (await listTimeRecords(
    [{ column: 'company_id', operator: 'eq', value: companyId }],
    { column: 'created_at', ascending: false },
    recordLimit,
  )) as OperationalPunchRecord[];

  const byUser = new Map<string, OperationalPunchRecord[]>();
  for (const r of records) {
    const uid = String(r.user_id);
    const arr = byUser.get(uid) ?? [];
    arr.push(r);
    byUser.set(uid, arr);
  }

  const details: OperationalStateIntegrityReport['details'] = [];
  let stale_snapshot_count = 0;
  let orphan_snapshot_count = 0;

  for (const row of cosRows) {
    const userRaw = byUser.get(row.employee_id) ?? [];
    const last = lastValidPunchForUser(records, row.employee_id, nowMs);
    const expected = expectedStatusFromLast(last, userRaw, nowMs);
    const actual = parseOperationalStatusEnum(row.operational_status);

    if (userRaw.length === 0 && row.last_punch_record_id) {
      orphan_snapshot_count += 1;
      details.push({
        employee_id: row.employee_id,
        kind: 'orphan',
        message: 'Snapshot com last_punch mas sem registros na amostra',
      });
    }

    if (!row.last_punch_record_id && userRaw.length > 0) {
      details.push({
        employee_id: row.employee_id,
        kind: 'missing_punch',
        message: 'Snapshot sem last_punch com registros presentes',
      });
      stale_snapshot_count += 1;
    }

    if (last && row.last_punch_record_id && String(last.id) !== String(row.last_punch_record_id)) {
      stale_snapshot_count += 1;
      details.push({
        employee_id: row.employee_id,
        kind: 'timestamp',
        message: `last_punch_record_id divergente (cos=${row.last_punch_record_id} vs feed=${last.id})`,
      });
    }

    if (expected !== actual) {
      details.push({
        employee_id: row.employee_id,
        kind: 'status',
        message: `status divergente (cos=${actual} esperado=${expected})`,
      });
    }

    if (last && row.last_punch_at) {
      const cosNorm = normalizeOperationalDate(row.last_punch_at, { quiet: true, source: 'cos_audit_last_punch' });
      const cosMs = cosNorm?.instantMs ?? NaN;
      const lastMs = recordPunchInstantMs(last);
      if (Number.isFinite(cosMs) && Number.isFinite(lastMs) && Math.abs(cosMs - lastMs) > 60_000) {
        details.push({
          employee_id: row.employee_id,
          kind: 'timestamp',
          message: 'last_punch_at divergente da última batida válida',
        });
        stale_snapshot_count += 1;
      }
    }

    const lat = row.map_latitude;
    const lng = row.map_longitude;
    if (lat != null && lng != null && last) {
      const rLat = last.latitude != null ? Number(last.latitude) : null;
      const rLng = last.longitude != null ? Number(last.longitude) : null;
      if (rLat != null && rLng != null && Number.isFinite(rLat) && Number.isFinite(rLng)) {
        const d = Math.hypot(lat - rLat, lng - rLng);
        if (d > 0.02) {
          details.push({
            employee_id: row.employee_id,
            kind: 'geo',
            message: 'GEO snapshot distante da última batida com coordenadas',
          });
        }
      }
    }

    if (actual === EmployeeOperationalStatus.OFFLINE && expected !== EmployeeOperationalStatus.OFFLINE) {
      details.push({
        employee_id: row.employee_id,
        kind: 'offline',
        message: 'Possível offline incorreto vs última batida',
      });
    }
  }

  const drift_count = details.filter((d) => d.kind === 'status' || d.kind === 'geo').length;

  if (details.length > 0) {
    observabilityConsole.warn('[CURRENT STATE DRIFT DETECTED]', {
      company_id: companyId,
      drift_count,
      stale_snapshot_count,
      orphan_snapshot_count,
      samples: details.slice(0, 20),
    });
    recordOperationalMetric('cos_drift_detected_count', drift_count, { company_id: companyId });
    recordOperationalMetric('cos_stale_snapshot_count', stale_snapshot_count, { company_id: companyId });
    recordOperationalMetric('cos_orphan_snapshot_count', orphan_snapshot_count, { company_id: companyId });
  }

  return {
    drift_count,
    stale_snapshot_count,
    orphan_snapshot_count,
    details,
  };
}

/** Audita e força refresh nos colaboradores com divergência. */
export async function repairOperationalStateDrift(
  client: SupabaseClient,
  companyId: string,
  correlationId: string = createOperationalCorrelationId(),
): Promise<{ repaired_count: number; report: OperationalStateIntegrityReport }> {
  const report = await auditCurrentOperationalStateIntegrity(client, companyId);
  const toRepair = new Set<string>();
  for (const d of report.details) {
    toRepair.add(d.employee_id);
  }
  let repaired_count = 0;
  for (const emp of toRepair) {
    const r = await refreshCurrentOperationalStateRpc(companyId, emp, {
      source: 'reconciliation',
      eventAt: operationalNowUtcIso(),
      force: true,
      correlationId,
      client,
    });
    if (r.ok) repaired_count += 1;
  }
  if (repaired_count > 0) {
    observabilityConsole.info('[STATE AUTO RECOVERED]', { company_id: companyId, correlation_id: correlationId, repaired_count });
    observabilityConsole.info('[CURRENT STATE REPAIRED]', {
      company_id: companyId,
      correlation_id: correlationId,
      repaired_count,
      state_version: null,
      state_source: 'reconciliation',
    });
    recordOperationalMetric('cos_repaired_count', repaired_count, { company_id: companyId });
  }
  return { repaired_count, report };
}
