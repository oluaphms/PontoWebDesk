/**
 * Serviço de evidência de registro e alertas de fraude (SmartPonto Antifraude).
 */

import { supabase, db, isSupabaseConfigured } from './supabaseClient';

export interface SavePunchEvidenceParams {
  timeRecordId: string;
  photoUrl?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  deviceId?: string | null;
  fraudScore?: number | null;
}

export interface CreateFraudAlertParams {
  employeeId: string;
  timeRecordId?: string | null;
  type: string;
  description?: string | null;
  severity?: 'low' | 'medium' | 'high';
}

export async function savePunchEvidence(params: SavePunchEvidenceParams): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
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
    if (!rpcError) return;

    if (import.meta.env?.DEV && typeof console !== 'undefined') {
      console.warn('[punch_evidence] RPC falhou, tentando insert direto:', rpcError);
    }
    await db.insert('punch_evidence', row);
  } catch (e) {
    if (import.meta.env?.DEV && typeof console !== 'undefined') {
      console.warn('[punch_evidence] insert falhou (não bloqueia o ponto):', e);
    }
    // não falhar o registro principal
  }
}

export async function createFraudAlert(params: CreateFraudAlertParams): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
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
