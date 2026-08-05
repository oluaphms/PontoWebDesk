import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Fonte única: `current_operational_state` (Supabase), atualizada por trigger em time_records
 * e alinhada ao hard lock GEO em PL/pgSQL. UI (monitoramento, cards) deve consumir esta API.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';
import {
  EmployeeOperationalStatus,
  operationalStatusLabel,
} from '../types/employeeOperationalStatus';
import {
  formatOperationalLocalDisplay,
  punchInstantOperationalYmd,
  type GeoPrecisionBadge,
  type MonitoringGeoSourceKind,
  type MonitoringPipelineEmployeeRow,
} from './monitoring/monitoringGeoHardLock.service';
import { calculateGeoConfidence, type GeoConfidenceLevel } from './geolocation/geoConfidence.service';
import { normalizeOperationalDate, operationalNowUtcIso } from '../utils/operationalDateHardLock';
import { operationalClockMs } from '../utils/operationalClock';
import { rosterIdSet } from './monitoring/monitoringRoster.service';

export type CurrentOperationalStateRow = {
  company_id: string;
  employee_id: string;
  operational_status: string;
  last_punch_type: string | null;
  last_punch_record_id: string | null;
  last_punch_at: string | null;
  last_punch_origin: string | null;
  last_punch_method: string | null;
  map_latitude: number | null;
  map_longitude: number | null;
  map_accuracy: number | null;
  map_captured_at: string | null;
  geo_provider: string | null;
  geo_origin_kind: string | null;
  location_confidence: string;
  is_online: boolean;
  journey: Record<string, unknown> | null;
  updated_at: string;
  last_update_source: string | null;
  state_version: number;
  last_event_sequence: number | null;
  state_source: string | null;
  last_event_at: string | null;
  /** md5(lat|lng|accuracy|captured_utc|state_version) — ver migração geo_checksum. */
  geo_snapshot_checksum?: string | null;
};

export function currentOperationalStateCacheKey(companyId: string): string {
  return `current_operational_state:${companyId}`;
}

export async function fetchCurrentOperationalStateByCompany(
  companyId: string,
  clientOverride?: SupabaseClient | null,
): Promise<CurrentOperationalStateRow[]> {
  const client = clientOverride ?? getSupabaseClient();
  if (!client || !companyId) return [];
  const { data, error } = await client
    .from('current_operational_state')
    .select(
      'company_id, employee_id, operational_status, last_punch_type, last_punch_record_id, last_punch_at, last_punch_origin, last_punch_method, map_latitude, map_longitude, map_accuracy, map_captured_at, geo_provider, geo_origin_kind, location_confidence, is_online, journey, updated_at, last_update_source, state_version, last_event_sequence, state_source, last_event_at, geo_snapshot_checksum',
    )
    .eq('company_id', companyId);
  if (error) {
    if (typeof console !== 'undefined') {
      observabilityConsole.warn('[current_operational_state] fetch', error.message);
    }
    return [];
  }
  const rows = data ?? [];
  return rows.map((raw) => {
    const r = raw as CurrentOperationalStateRow;
    return {
      ...r,
      state_version: Number(r.state_version ?? 0),
      last_event_sequence: r.last_event_sequence ?? null,
      state_source: r.state_source ?? null,
      last_event_at: r.last_event_at ?? null,
    };
  });
}

export function parseOperationalStatusEnum(raw: string | null | undefined): EmployeeOperationalStatus {
  const s = String(raw ?? '').trim().toUpperCase();
  const values = Object.values(EmployeeOperationalStatus) as string[];
  if (values.includes(s)) return s as EmployeeOperationalStatus;
  return EmployeeOperationalStatus.OFF_DUTY;
}

function confidenceToBadge(conf: string | null | undefined): GeoPrecisionBadge | undefined {
  const c = String(conf ?? '').toLowerCase();
  if (c === 'high') return 'preciso';
  if (c === 'medium') return 'aproximado';
  if (c === 'none' || c === '') return undefined;
  return 'sem_sinal';
}

function cosRowToGeoConfidence(row: CurrentOperationalStateRow, nowMs: number): GeoConfidenceLevel {
  const cap = row.map_captured_at != null
    ? normalizeOperationalDate(row.map_captured_at, { quiet: true, source: 'cosRowToGeoConfidence' })
    : null;
  const posAge = cap ? nowMs - cap.instantMs : null;
  const base = String(row.location_confidence ?? '').toLowerCase();
  const impossible = base === 'invalid';
  return calculateGeoConfidence(
    {
      accuracyMeters: row.map_accuracy,
      ageMs: posAge,
      provider: row.geo_provider,
      impossibleMovement: impossible,
    },
    { log: false },
  );
}

function normalizeGeoOrigin(raw: string | null | undefined): MonitoringGeoSourceKind | undefined {
  const s = String(raw ?? '').trim();
  if (s === 'REP' || s === 'App' || s === 'Cache' || s === 'Realtime') return s;
  return undefined;
}

/** Converte linha da tabela em linha do pipeline de monitoramento (mapa + cards). */
export function operationalStateRowToMonitoringPipelineRow(
  row: CurrentOperationalStateRow,
  user: { id: string; nome?: string; email?: string },
  nowMs: number = operationalClockMs(),
): MonitoringPipelineEmployeeRow {
  const status = parseOperationalStatusEnum(row.operational_status);
  const lastIso = row.last_punch_at ?? undefined;
  const posAge =
    row.map_captured_at != null ? nowMs - new Date(row.map_captured_at).getTime() : undefined;
  const geoConfidenceLevel = cosRowToGeoConfidence(row, nowMs);
  const mapMarkerKey = [
    row.last_punch_record_id ?? '',
    row.map_captured_at ?? '',
    row.map_latitude ?? '',
    row.map_longitude ?? '',
    row.updated_at ?? '',
    String(row.state_version ?? ''),
    row.state_source ?? '',
  ].join(':');

  return {
    userId: user.id,
    userName: user.nome || user.email || '—',
    status,
    statusLabel: operationalStatusLabel(status),
    lastRecordType: row.last_punch_type ?? undefined,
    lastRecordAt:
      lastIso != null
        ? formatOperationalLocalDisplay(lastIso, { employeeId: user.id, recordId: row.last_punch_record_id ?? undefined })
        : undefined,
    lat: row.map_latitude ?? undefined,
    lng: row.map_longitude ?? undefined,
    accuracy: row.map_accuracy ?? null,
    capturedAt: row.map_captured_at ?? undefined,
    sourceRecordId: row.last_punch_record_id ?? undefined,
    geoPrecisionBadge: confidenceToBadge(row.location_confidence),
    geoSourceLabel: normalizeGeoOrigin(row.geo_origin_kind),
    provider: row.geo_provider ?? null,
    positionAgeMs: Number.isFinite(posAge as number) ? posAge : undefined,
    mapMarkerKey,
    mapRenderTimestamp: nowMs,
    geoConfidenceLevel,
    stateVersion: row.state_version,
    stateSource: row.state_source,
    lastEventAt: row.last_event_at,
  };
}

export function emptyMonitoringPipelineRowForUser(
  user: { id: string; nome?: string; email?: string },
  nowMs: number = operationalClockMs(),
): MonitoringPipelineEmployeeRow {
  const status = EmployeeOperationalStatus.NO_SHIFT;
  return {
    userId: user.id,
    userName: user.nome || user.email || '—',
    status,
    statusLabel: operationalStatusLabel(status),
    mapRenderTimestamp: nowMs,
  };
}

export type PresenceStatus = 'working' | 'break' | 'lunch' | 'off_duty';

export interface EmployeePresenceFromState {
  user_id: string;
  nome: string;
  email?: string;
  status: PresenceStatus;
  lastPunch?: string;
  lastType?: string;
  pairCount: number;
  offDutyReason?: 'no_punch_today' | 'journey_closed' | 'other';
  classificationReason?: string;
}

export function operationalStatusToPresenceStatus(st: EmployeeOperationalStatus): PresenceStatus {
  if (st === EmployeeOperationalStatus.WORKING) return 'working';
  if (st === EmployeeOperationalStatus.BREAK) return 'break';
  if (st === EmployeeOperationalStatus.LUNCH) return 'lunch';
  return 'off_duty';
}

/** Presença “Hoje” a partir do snapshot + dia civil SP (sem segunda derivação de time_records). */
export function buildPresenceListFromOperationalState(
  users: { id: string; nome?: string; email?: string }[],
  rowsByEmployee: Map<string, CurrentOperationalStateRow>,
  todayYmd: string,
  rosterIdAliases?: Map<string, string[]>,
): EmployeePresenceFromState[] {
  const result: EmployeePresenceFromState[] = [];
  for (const u of users) {
    let row: CurrentOperationalStateRow | undefined;
    for (const id of rosterIdSet(u.id, rosterIdAliases)) {
      const candidate = rowsByEmployee.get(id);
      if (candidate) {
        row = candidate;
        break;
      }
    }
    if (!row?.last_punch_at) {
      result.push({
        user_id: u.id,
        nome: u.nome || u.email || u.id.slice(0, 8),
        email: u.email,
        status: 'off_duty',
        pairCount: 0,
      });
      continue;
    }
    const ymd = punchInstantOperationalYmd({
      timestamp: row.last_punch_at,
      created_at: row.last_punch_at,
    });
    if (ymd !== todayYmd) {
      result.push({
        user_id: u.id,
        nome: u.nome || u.email || u.id.slice(0, 8),
        email: u.email,
        status: 'off_duty',
        lastPunch: row.last_punch_at,
        lastType: row.last_punch_type ?? undefined,
        pairCount: 0,
      });
      continue;
    }
    const st = parseOperationalStatusEnum(row.operational_status);
    result.push({
      user_id: u.id,
      nome: u.nome || u.email || u.id.slice(0, 8),
      email: u.email,
      status: operationalStatusToPresenceStatus(st),
      lastPunch: row.last_punch_at,
      lastType: row.last_punch_type ?? undefined,
      pairCount: 0,
    });
  }
  return result.sort((a, b) => a.nome.localeCompare(b.nome));
}

export type RefreshCurrentOperationalStateRpcOptions = {
  source?: string;
  eventAt?: string;
  force?: boolean;
  correlationId?: string | null;
  client?: SupabaseClient | null;
};

/**
 * RPC opcional: replay / reconciliação quando o trigger não cobre o efeito desejado.
 */
export async function refreshCurrentOperationalStateRpc(
  companyId: string,
  employeeId: string,
  opts: RefreshCurrentOperationalStateRpcOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const {
    source = 'replay',
    eventAt = operationalNowUtcIso(),
    force = false,
    correlationId = null,
    client: clientOpt = null,
  } = opts;
  const client = clientOpt ?? getSupabaseClient();
  if (!client) return { ok: false, error: 'no_client' };
  const { error } = await client.rpc('refresh_current_operational_state_rpc', {
    p_company_id: companyId,
    p_employee_id: employeeId,
    p_source: source,
    p_event_at: eventAt,
    p_force: force,
    p_correlation_id: correlationId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
