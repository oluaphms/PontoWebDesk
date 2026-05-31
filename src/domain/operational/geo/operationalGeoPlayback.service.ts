import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
/**
 * Playback forense / RH: reconstrói trilha a partir de operational_state_history (append-only).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../../lib/supabaseClient';
import { normalizeOperationalDate } from '../../../utils/operationalDateHardLock';
import { computeGeoForensicsScore, type GeoForensicsPoint } from './geoForensics.service';

export type OperationalStateHistoryRow = {
  id: number;
  company_id: string;
  employee_id: string;
  recorded_at: string;
  snapshot: Record<string, unknown>;
};

export type OperationalGeoTrailPoint = GeoForensicsPoint & {
  recordedAt: string;
  stateVersion?: number | null;
};

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchOperationalStateHistoryRange(
  companyId: string,
  employeeId: string,
  opts?: { fromIso?: string; toIso?: string; limit?: number },
  clientOverride?: SupabaseClient | null,
): Promise<OperationalStateHistoryRow[]> {
  const client = clientOverride ?? getSupabaseClient();
  if (!client) return [];
  let q = client
    .from('operational_state_history')
    .select('id, company_id, employee_id, recorded_at, snapshot')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .order('recorded_at', { ascending: true });
  if (opts?.fromIso) q = q.gte('recorded_at', opts.fromIso);
  if (opts?.toIso) q = q.lte('recorded_at', opts.toIso);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) {
    observabilityConsole.warn('[operational_state_history]', error.message);
    return [];
  }
  return (data ?? []) as OperationalStateHistoryRow[];
}

/** Extrai pontos GEO a partir dos snapshots JSON (COS). */
export function buildGeoTrailFromStateHistory(rows: OperationalStateHistoryRow[]): OperationalGeoTrailPoint[] {
  const out: OperationalGeoTrailPoint[] = [];
  for (const row of rows) {
    const snap = row.snapshot ?? {};
    const lat = num(snap.map_latitude);
    const lng = num(snap.map_longitude);
    if (lat == null || lng == null) continue;
    const capRaw = snap.map_captured_at != null ? String(snap.map_captured_at) : row.recorded_at;
    const n = normalizeOperationalDate(capRaw, { quiet: true, source: 'playbackTrail' });
    const atMs = n ? n.instantMs : NaN;
    if (!Number.isFinite(atMs)) continue;
    out.push({
      atMs,
      latitude: lat,
      longitude: lng,
      accuracyMeters: num(snap.map_accuracy),
      mocked: typeof snap.geo_provider === 'string' ? /mock/i.test(String(snap.geo_provider)) : null,
      recordedAt: row.recorded_at,
      stateVersion: num(snap.state_version),
    });
  }
  return out;
}

/**
 * Facade pedida na especificação (playback + forense).
 */
export class OperationalGeoPlayback {
  static async loadTrail(
    companyId: string,
    employeeId: string,
    client: SupabaseClient | null,
    opts?: { fromIso?: string; toIso?: string; limit?: number },
  ): Promise<{ history: OperationalStateHistoryRow[]; trail: OperationalGeoTrailPoint[] }> {
    if (!client) return { history: [], trail: [] };
    const history = await fetchOperationalStateHistoryRange(companyId, employeeId, opts, client);
    const trail = buildGeoTrailFromStateHistory(history);
    return { history, trail };
  }

  static analyzeTrail(trail: OperationalGeoTrailPoint[]) {
    return computeGeoForensicsScore(trail);
  }
}
