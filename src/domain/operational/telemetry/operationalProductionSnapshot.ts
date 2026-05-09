import type { SupabaseClient } from '@supabase/supabase-js';

export type OperationalProductionSnapshotInput = {
  companyId: string;
  realtimeLatencyMs: number;
  renderLatencyMs: number;
  geoAcceptanceRate: number;
  geoRejectionRate: number;
  staleBlockRate: number;
  ghostRemovalRate: number;
  selfHealFrequency: number;
  incidentFrequency: number;
  reconnectStorms: number;
  replayVolume: number;
  batteryDegradationRate: number;
  mobileFreezeCount: number;
  mapRenderRejectionRate: number;
  gpsUnstableRate: number;
};

export async function saveOperationalProductionSnapshot(
  input: OperationalProductionSnapshotInput,
  client: SupabaseClient | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!client) return { ok: false, error: 'no_client' };
  const payload = {
    company_id: input.companyId,
    snapshot_kind: 'operational_production',
    payload: {
      realtime_latency_ms: input.realtimeLatencyMs,
      render_latency_ms: input.renderLatencyMs,
      geo_acceptance_rate: input.geoAcceptanceRate,
      geo_rejection_rate: input.geoRejectionRate,
      stale_block_rate: input.staleBlockRate,
      ghost_removal_rate: input.ghostRemovalRate,
      self_heal_frequency: input.selfHealFrequency,
      incident_frequency: input.incidentFrequency,
      reconnect_storms: input.reconnectStorms,
      replay_volume: input.replayVolume,
      battery_degradation_rate: input.batteryDegradationRate,
      mobile_freeze_count: input.mobileFreezeCount,
      map_render_rejection_rate: input.mapRenderRejectionRate,
      gps_unstable_rate: input.gpsUnstableRate,
    },
  };
  const { error } = await client.from('operational_legal_audit_trail').insert({
    company_id: input.companyId,
    actor_id: null,
    action: 'production_snapshot_generated',
    source: 'operationalProductionSnapshot',
    payload_after: payload,
  });
  if (error) return { ok: false, error: error.message };
  console.info('[PRODUCTION SNAPSHOT GENERATED]', {
    company_id: input.companyId,
    realtime_latency_ms: input.realtimeLatencyMs,
    render_latency_ms: input.renderLatencyMs,
  });
  return { ok: true };
}

