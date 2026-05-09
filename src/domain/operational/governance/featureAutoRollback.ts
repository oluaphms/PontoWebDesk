import { setOperationalFeatureOverrides } from '../../../config/operationalFeatureFlags';

export type FeatureHealthInput = {
  companyId: string;
  feature: string;
  incidentsCritical: number;
  rejectionRate: number;
  mapRenderRejectionRate: number;
  staleRate: number;
  gpsTrustScore: number;
};

export function evaluateFeatureHealthAndRollback(input: FeatureHealthInput): boolean {
  const unhealthy =
    input.incidentsCritical >= 3 ||
    input.rejectionRate > 0.55 ||
    input.mapRenderRejectionRate > 0.4 ||
    input.staleRate > 0.35 ||
    input.gpsTrustScore < 40;
  if (!unhealthy) return false;
  console.warn('[FEATURE HEALTH FAILURE]', {
    company_id: input.companyId,
    feature: input.feature,
    incidents_critical: input.incidentsCritical,
    rejection_rate: input.rejectionRate,
    map_render_rejection_rate: input.mapRenderRejectionRate,
    stale_rate: input.staleRate,
    gps_trust_score: input.gpsTrustScore,
  });
  setOperationalFeatureOverrides([
    {
      companyId: input.companyId,
      flags: {
        geoConsensus: input.feature === 'geoConsensus' ? false : undefined,
        nativeGps: input.feature === 'nativeGps' ? false : undefined,
        realtimeCoordinator: input.feature === 'realtimeCoordinator' ? false : undefined,
        geoForensics: input.feature === 'geoForensics' ? false : undefined,
        operationalIncidents: input.feature === 'operationalIncidents' ? false : undefined,
        scaleMode: input.feature === 'scaleMode' ? false : undefined,
        cosStrictMode: input.feature === 'cosStrictMode' ? false : undefined,
        mapStaleBlock: input.feature === 'mapStaleBlock' ? false : undefined,
        geoHealthGuard: input.feature === 'geoHealthGuard' ? false : undefined,
      },
    },
  ]);
  console.warn('[FEATURE AUTO ROLLBACK]', { company_id: input.companyId, feature: input.feature });
  return true;
}

