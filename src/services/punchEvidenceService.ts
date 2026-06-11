import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Serviço de evidência de registro e alertas de fraude (SmartPonto Antifraude).
 */

import { supabase, db, isSupabaseConfigured } from '../../services/supabaseClient';
import { SYSTEM_CONFIG } from '../config/system';

export interface SavePunchEvidenceParams {
  timeRecordId: string;
  photoUrl?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  deviceId?: string | null;
  fraudScore?: number | null;
  geoSnapshot?: Record<string, unknown> | null;
  geoValidationIssues?: string[] | null;
}

export interface CreateFraudAlertParams {
  employeeId: string;
  timeRecordId?: string | null;
  type: string;
  description?: string | null;
  severity?: 'low' | 'medium' | 'high';
}

async function persistGeoSnapshotOnTimeRecord(
  timeRecordId: string,
  geoSnapshot: Record<string, unknown>,
): Promise<void> {
  const rows = await db.select(
    'time_records',
    [{ column: 'id', operator: 'eq', value: timeRecordId }],
    undefined,
    1,
  );
  const row = rows[0];
  const prevRaw =
    row?.raw_data && typeof row.raw_data === 'object' && !Array.isArray(row.raw_data)
      ? (row.raw_data as Record<string, unknown>)
      : {};
  if (prevRaw.geo_snapshot) return;
  await db.update('time_records', timeRecordId, {
    raw_data: { ...prevRaw, geo_snapshot: geoSnapshot },
  });
}

export async function savePunchEvidence(params: SavePunchEvidenceParams): Promise<void> {
  const isLocalApi = SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API';

  if (isLocalApi) {
    if (params.geoSnapshot) {
      try {
        await persistGeoSnapshotOnTimeRecord(params.timeRecordId, params.geoSnapshot);
      } catch (e) {
        if (import.meta.env?.DEV && typeof console !== 'undefined') {
          observabilityConsole.warn('[punch_evidence] geo snapshot (LOCAL_API) falhou:', e);
        }
      }
    }
    return;
  }

  if (!isSupabaseConfigured()) return;
  const row = {
    time_record_id: params.timeRecordId,
    photo_url: params.photoUrl ?? null,
    location_lat: params.locationLat ?? null,
    location_lng: params.locationLng ?? null,
    device_id: params.deviceId ?? null,
    fraud_score: params.fraudScore ?? null,
  };
  try {
    const { error: rpcError } = await supabase.rpc('insert_punch_evidence_for_own_punch', {
      p_time_record_id: params.timeRecordId,
      p_photo_url: params.photoUrl ?? null,
      p_location_lat: params.locationLat ?? null,
      p_location_lng: params.locationLng ?? null,
      p_device_id: params.deviceId ?? null,
      p_fraud_score: params.fraudScore ?? null,
    });
    if (rpcError) {
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        observabilityConsole.warn('[punch_evidence] RPC falhou, tentando insert direto:', rpcError);
      }
      await db.insert('punch_evidence', row);
    }
  } catch (e) {
    if (import.meta.env?.DEV && typeof console !== 'undefined') {
      observabilityConsole.warn('[punch_evidence] insert falhou (não bloqueia o ponto):', e);
    }
    // não falhar o registro principal
  }

  if (params.geoSnapshot) {
    try {
      await supabase.rpc('set_time_record_geo_snapshot_if_absent', {
        p_time_record_id: params.timeRecordId,
        p_geo_snapshot: params.geoSnapshot,
        p_geo_validation_issues: params.geoValidationIssues ?? [],
      });
    } catch (e) {
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        observabilityConsole.warn('[punch_evidence] geo snapshot rpc falhou:', e);
      }
    }
  }
}

export async function createFraudAlert(params: CreateFraudAlertParams): Promise<void> {
  if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') return;
  if (!isSupabaseConfigured()) return;
  try {
    await db.insert('fraud_alerts', {
      employee_id: params.employeeId,
      time_record_id: params.timeRecordId ?? null,
      type: params.type,
      description: params.description ?? null,
      severity: params.severity ?? 'medium',
    });
  } catch {
    // não falhar o registro principal
  }
}

export async function createFraudAlertsForFlags(
  employeeId: string,
  timeRecordId: string,
  flags: string[]
): Promise<void> {
  const labels: Record<string, string> = {
    location_violation: 'Registro fora da área autorizada',
    device_unknown: 'Dispositivo não reconhecido',
    face_mismatch: 'Face não confere com o cadastro',
    behavior_anomaly: 'Anomalia comportamental detectada',
  };
  for (const type of flags) {
    await createFraudAlert({
      employeeId,
      timeRecordId,
      type,
      description: labels[type] || type,
      severity: type === 'face_mismatch' || type === 'location_violation' ? 'high' : 'medium',
    });
  }
}
