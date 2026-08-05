export type OperationalScaleTier = 'STANDARD' | 'HIGH_DENSITY' | 'EXTREME';

export type OperationalScalePlan = {
  tier: OperationalScaleTier;
  useMarkerClustering: boolean;
  viewportOnly: boolean;
  lazyHydrationBatch: number;
  streamPartitions: number;
  tenantIsolationStrict: boolean;
};

export function resolveOperationalScalePlan(visibleEmployees: number): OperationalScalePlan {
  if (visibleEmployees >= 1000) {
    return {
      tier: 'EXTREME',
      useMarkerClustering: true,
      viewportOnly: true,
      lazyHydrationBatch: 40,
      streamPartitions: 8,
      tenantIsolationStrict: true,
    };
  }
  if (visibleEmployees >= 300) {
    return {
      tier: 'HIGH_DENSITY',
      useMarkerClustering: true,
      viewportOnly: true,
      lazyHydrationBatch: 80,
      streamPartitions: 4,
      tenantIsolationStrict: true,
    };
  }
  return {
    tier: 'STANDARD',
    useMarkerClustering: false,
    viewportOnly: false,
    lazyHydrationBatch: 150,
    streamPartitions: 2,
    tenantIsolationStrict: true,
  };
}

