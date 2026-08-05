export type OperationalStats = {
  incidents: number;
  retries: number;
  degraded_tenants: number;
};

export function diffOperational(before: OperationalStats, after: OperationalStats): OperationalStats {
  return {
    incidents: after.incidents - before.incidents,
    retries: after.retries - before.retries,
    degraded_tenants: after.degraded_tenants - before.degraded_tenants,
  };
}
