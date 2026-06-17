/**
 * Fonte operacional única do Monitoramento — alinhada à Dashboard (batidas do dia + COS + live).
 * Consumido exclusivamente pela página Monitoramento.
 */

import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import { db } from '../supabaseClient';
import { fetchEmployees, type ApiEmployee } from '../employeesApi.service';
import { fetchLiveLocationsForCompany, flagStaleLiveLocations, type LiveEmployeeLocationRow } from '../liveEmployeeLocation.service';
import {
  currentOperationalStateCacheKey,
  fetchCurrentOperationalStateByCompany,
  type CurrentOperationalStateRow,
  type EmployeePresenceFromState,
} from '../currentOperationalState.service';
import { queryCache } from '../queryCache';
import { resolveUnifiedOperationalState } from '../../domain/operational/unifiedOperationalResolver';
import { operationalClockMs, formatOperationalTimeHmFromIso } from '../../utils/operationalDateHardLock';
import { recordPunchInstantMs, recordPunchInstantIso } from '../../utils/punchOrigin';
import { normalizePunchType } from '../../types/employeeOperationalStatus';
import { fetchMonitoringTimeRecordsBundle } from './monitoringData.service';
import {
  buildMonitoringRosterWithFallback,
  buildRecordUserToRosterIdMap,
  filterRecordsForRosterMember,
  type MonitoringRosterUser,
} from './monitoringRoster.service';
import {
  filterRecordsForOperationalDay,
  getCompanyTodayYmd,
  type MonitoringPipelineEmployeeRow,
  type OperationalPunchRecord,
  validateOperationalTimestamp,
} from './monitoringGeoHardLock.service';

export type MonitoringTimelineEvent = {
  id: string;
  at: string;
  atLabel: string;
  employeeName: string;
  punchType: string;
  punchTypeLabel: string;
  originLabel?: string;
};

export type MonitoringDiagnosticInfo = {
  dataSource: string;
  lastRefreshAt: string;
  lastRefreshLabel: string;
  recordsLoaded: number;
  employeesProcessed: number;
  markersRenderable: number;
  statusCalculated: number;
  usingCos: boolean;
  cosRows: number;
  todayYmd: string;
};

export type MonitoringOperationalSnapshot = {
  companyId: string;
  todayYmd: string;
  nowMs: number;
  roster: MonitoringRosterUser[];
  cosRows: CurrentOperationalStateRow[];
  liveRows: LiveEmployeeLocationRow[];
  timeRecords: OperationalPunchRecord[];
  pipelineRows: MonitoringPipelineEmployeeRow[];
  presenceList: EmployeePresenceFromState[];
  timeline: MonitoringTimelineEvent[];
  diagnostic: MonitoringDiagnosticInfo;
};

function punchTypeLabel(raw: string): string {
  const t = normalizePunchType(raw);
  if (t === 'entrada') return 'Entrada';
  if (t === 'saida') return 'Saída';
  if (t === 'pausa') return 'Pausa';
  if (t === 'intervalo_saida') return 'Intervalo';
  if (t === 'intervalo_volta') return 'Volta do intervalo';
  return raw || 'Registro';
}

export function formatActiveDuration(lastPunchIso: string | undefined, nowMs: number): string {
  if (!lastPunchIso) return '—';
  const v = validateOperationalTimestamp(lastPunchIso, nowMs);
  if (!v.ok) return '—';
  const diffMs = Math.max(0, nowMs - v.instantMs);
  const hours = Math.floor(diffMs / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours <= 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

export function offDutyDisplayLabel(row: EmployeePresenceFromState): string {
  if (row.offDutyReason === 'no_punch_today') return 'Sem registros hoje';
  if (row.offDutyReason === 'journey_closed') {
    const hm = formatOperationalTimeHmFromIso(row.lastPunch);
    return hm ? `Jornada encerrada às ${hm}` : 'Jornada encerrada';
  }
  return row.lastPunch ? 'Fora da jornada' : 'Sem registros hoje';
}

export function buildMonitoringActivityTimeline(
  todayRecords: OperationalPunchRecord[],
  roster: MonitoringRosterUser[],
  rosterIdAliases: Map<string, string[]>,
  recordUserToRosterId: Map<string, string>,
  todayYmd: string,
  limit = 24,
): MonitoringTimelineEvent[] {
  const nameByRosterId = new Map(roster.map((r) => [r.id, r.nome]));
  const dayRecords = filterRecordsForOperationalDay(todayRecords, todayYmd)
    .filter((r) => validateOperationalTimestamp(recordPunchInstantIso(r)).ok)
    .sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));

  const events: MonitoringTimelineEvent[] = [];
  for (const r of dayRecords) {
    const uid = String(r.user_id ?? '');
    const rosterId =
      recordUserToRosterId.get(uid) ??
      roster.find((m) => filterRecordsForRosterMember([r], m.id, rosterIdAliases, recordUserToRosterId).length > 0)?.id;
    if (!rosterId) continue;
    const at = recordPunchInstantIso(r);
    events.push({
      id: String(r.id),
      at,
      atLabel: formatOperationalTimeHmFromIso(at) ?? at,
      employeeName: nameByRosterId.get(rosterId) ?? rosterId.slice(0, 8),
      punchType: String(r.type ?? ''),
      punchTypeLabel: punchTypeLabel(String(r.type ?? '')),
    });
    if (events.length >= limit) break;
  }
  return events;
}

export function logMonitoringInvestigation(snapshot: MonitoringOperationalSnapshot): void {
  const gpsRows = snapshot.pipelineRows.filter((r) => r.lat != null && r.lng != null && !r.geoLocationExpired);
  observabilityConsole.info('[MONITORAMENTO]', {
    colaboradores_roster: snapshot.roster.length,
    registros_bundle: snapshot.timeRecords.length,
    com_gps_pipeline: gpsRows.length,
    usando_cos: snapshot.diagnostic.usingCos,
    dia_operacional: snapshot.todayYmd,
  });
  observabilityConsole.info(
    '[MONITORAMENTO_STATUS]',
    snapshot.presenceList.map((e) => ({
      nome: e.nome,
      status: e.status,
      lastPunch: e.lastPunch,
      lastType: e.lastType,
      motivo: e.classificationReason,
      offDutyReason: e.offDutyReason,
    })),
  );
  observabilityConsole.info(
    '[MONITORAMENTO_GPS]',
    snapshot.pipelineRows.map((r) => ({
      nome: r.userName,
      lat: r.lat,
      lng: r.lng,
      expired: r.geoLocationExpired,
      confidence: r.geoConfidenceLevel,
      motivo: r.classificationReason,
    })),
  );
  observabilityConsole.info('[MONITORAMENTO_STATE]', {
    fonte: snapshot.diagnostic.dataSource,
    cos_linhas: snapshot.diagnostic.cosRows,
    ultima_atualizacao: snapshot.diagnostic.lastRefreshLabel,
  });
  observabilityConsole.info('[MONITORAMENTO_MAP]', {
    pins_esperados: gpsRows.length,
    colaboradores_processados: snapshot.diagnostic.employeesProcessed,
  });
}

export async function loadMonitoringOperationalSnapshot(companyId: string): Promise<MonitoringOperationalSnapshot> {
  const todayYmd = getCompanyTodayYmd();
  const nowMs = operationalClockMs();
  const refreshedAt = new Date(nowMs);

  const usersRows = (await db.select(
    'users',
    [{ column: 'company_id', operator: 'eq', value: companyId }],
    { columns: 'id,email,nome,role,status', limit: 500 },
  )) as Array<{ id?: string; email?: string | null; nome?: string; role?: string; status?: string }>;

  let employeesRows: ApiEmployee[] = [];
  try {
    employeesRows = await fetchEmployees(companyId);
  } catch {
    /* fallback abaixo */
  }
  if (employeesRows.length === 0) {
    try {
      const dbEmployees = (await db.select(
        'employees',
        [{ column: 'company_id', operator: 'eq', value: companyId }],
        { columns: 'id,nome,email,role,status,invisivel', limit: 500 },
      )) as ApiEmployee[];
      if (dbEmployees.length > 0) employeesRows = dbEmployees;
    } catch {
      /* roster via users */
    }
  }

  const { roster, aliases: rosterIdAliases } = buildMonitoringRosterWithFallback(employeesRows, usersRows ?? []);
  const recordUserToRosterId = buildRecordUserToRosterIdMap(roster, rosterIdAliases, employeesRows, usersRows ?? []);

  const [cosRows, liveRaw, timeRecords] = await Promise.all([
    fetchCurrentOperationalStateByCompany(companyId),
    fetchLiveLocationsForCompany(companyId),
    fetchMonitoringTimeRecordsBundle(companyId),
  ]);
  queryCache.set(currentOperationalStateCacheKey(companyId), cosRows, 15_000);

  const liveRows = flagStaleLiveLocations(liveRaw, nowMs);
  const liveByEmployee = new Map(liveRows.map((r) => [r.employee_id, r]));

  const unified = resolveUnifiedOperationalState({
    companyId,
    users: roster,
    cosRows,
    timeRecords,
    liveByEmployee,
    todayYmd,
    nowMs,
    rosterIdAliases,
    recordUserToRosterId,
  });

  const markersRenderable = unified.pipelineRows.filter(
    (r) => r.lat != null && r.lng != null && !r.geoLocationExpired && r.geoConfidenceLevel !== 'INVALID',
  ).length;

  const timeline = buildMonitoringActivityTimeline(
    timeRecords,
    roster,
    rosterIdAliases,
    recordUserToRosterId,
    todayYmd,
  );

  const snapshot: MonitoringOperationalSnapshot = {
    companyId,
    todayYmd,
    nowMs,
    roster,
    cosRows,
    liveRows,
    timeRecords,
    pipelineRows: unified.pipelineRows,
    presenceList: unified.presenceList,
    timeline,
    diagnostic: {
      dataSource: unified.usingOperationalStateTable
        ? 'time_records (dia) + current_operational_state + live_employee_location'
        : 'time_records (dia operacional SP)',
      lastRefreshAt: refreshedAt.toISOString(),
      lastRefreshLabel: refreshedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      recordsLoaded: timeRecords.length,
      employeesProcessed: roster.length,
      markersRenderable,
      statusCalculated: unified.presenceList.length,
      usingCos: unified.usingOperationalStateTable,
      cosRows: cosRows.length,
      todayYmd,
    },
  };

  logMonitoringInvestigation(snapshot);
  return snapshot;
}
