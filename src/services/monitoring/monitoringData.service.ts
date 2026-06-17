/**
 * Consultas de registros do Monitoramento — mesma janela operacional da Dashboard,
 * sem alterar dashboard.service.ts.
 */

import { db } from '../supabaseClient';
import { listTimeRecords } from '../../../services/timeRecords.service';
import { queryCache, TTL } from '../queryCache';
import { buildOperationalDayRange, getOperationalTodayYmd } from '../../utils/operationalDateHardLock';
import { recordPunchInstantIso } from '../../utils/punchOrigin';
import { isCloudEnabled } from '../cloudService';
import { cloudFallback } from '../cloudFallback';
import type { OperationalPunchRecord } from './monitoringGeoHardLock.service';

const MONITORING_DAILY_RECORD_QUERY_LIMIT = 120;
const MONITORING_RECENT_RECORD_QUERY_LIMIT = 500;

function mergeMonitoringRecordRows(...recordGroups: OperationalPunchRecord[][]): OperationalPunchRecord[] {
  const seen = new Set<string>();
  const out: OperationalPunchRecord[] = [];
  for (const records of recordGroups) {
    for (const record of records ?? []) {
      const rawId = String(record?.id ?? '').trim();
      const key =
        rawId || `${String(record?.user_id ?? '')}:${recordPunchInstantIso(record)}:${String(record?.type ?? '')}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(record);
    }
  }
  return out;
}

/** Batidas do dia operacional (timestamp + created_at), alinhado à Dashboard. */
export async function fetchMonitoringDailyRecordCandidates(companyId: string): Promise<OperationalPunchRecord[]> {
  if (!isCloudEnabled()) return cloudFallback([]);
  const todayLocal = getOperationalTodayYmd();
  const { startUtcIso, endUtcIso } = buildOperationalDayRange(todayLocal);

  const [byPunchInstant, byCreatedAtFallback] = await Promise.all([
    queryCache.getOrFetch(
      `time_records:monitoring:daily:punch:${companyId}:${todayLocal}`,
      () =>
        db.select(
          'time_records',
          [
            { column: 'company_id', operator: 'eq', value: companyId },
            { column: 'timestamp', operator: 'gte', value: startUtcIso },
            { column: 'timestamp', operator: 'lte', value: endUtcIso },
          ],
          { column: 'timestamp', ascending: false },
          MONITORING_DAILY_RECORD_QUERY_LIMIT,
        ) as Promise<OperationalPunchRecord[]>,
      TTL.REALTIME,
    ),
    queryCache.getOrFetch(
      `time_records:monitoring:daily:created:${companyId}:${todayLocal}`,
      () =>
        db.select(
          'time_records',
          [
            { column: 'company_id', operator: 'eq', value: companyId },
            { column: 'created_at', operator: 'gte', value: startUtcIso },
            { column: 'created_at', operator: 'lte', value: endUtcIso },
          ],
          { column: 'created_at', ascending: false },
          MONITORING_DAILY_RECORD_QUERY_LIMIT,
        ) as Promise<OperationalPunchRecord[]>,
      TTL.REALTIME,
    ),
  ]);

  return mergeMonitoringRecordRows(byPunchInstant ?? [], byCreatedAtFallback ?? []);
}

/** Registros recentes + dia operacional (evita perder batidas de hoje em empresas com alto volume). */
export async function fetchMonitoringTimeRecordsBundle(companyId: string): Promise<OperationalPunchRecord[]> {
  if (!isCloudEnabled()) return cloudFallback([]);
  const [daily, recent] = await Promise.all([
    fetchMonitoringDailyRecordCandidates(companyId),
    listTimeRecords(
      [{ column: 'company_id', operator: 'eq', value: companyId }],
      { column: 'created_at', ascending: false },
      MONITORING_RECENT_RECORD_QUERY_LIMIT,
    ) as Promise<OperationalPunchRecord[]>,
  ]);
  return mergeMonitoringRecordRows(daily, recent);
}

export function monitoringDailyRecordsCacheKey(companyId: string): string {
  const todayLocal = getOperationalTodayYmd();
  return `time_records:monitoring:daily:punch:${companyId}:${todayLocal}`;
}
