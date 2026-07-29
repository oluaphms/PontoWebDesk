/**
 * Contadores HTTP em memória (P0.4) — processo único PM2.
 * Não substitui APM; exposto em GET /api/metrics/summary.
 */

type Bucket = {
  count: number;
  errors: number;
  totalDurationMs: number;
};

const byPath = new Map<string, Bucket>();
const byTenant = new Map<string, Bucket>();
let startedAt = Date.now();

function bump(map: Map<string, Bucket>, key: string, durationMs: number, isError: boolean): void {
  const cur = map.get(key) ?? { count: 0, errors: 0, totalDurationMs: 0 };
  cur.count += 1;
  cur.totalDurationMs += durationMs;
  if (isError) cur.errors += 1;
  map.set(key, cur);
}

function normalizePath(path: string): string {
  const raw = String(path || '').split('?')[0] || '/';
  // Evita cardinalidade alta de UUIDs na chave
  return raw.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    ':id',
  );
}

export function recordHttpRequest(input: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  companyId?: string | null;
}): void {
  const routeKey = `${input.method} ${normalizePath(input.path)}`;
  const isError = input.statusCode >= 500;
  bump(byPath, routeKey, input.durationMs, isError);
  const tenant = String(input.companyId || '').trim() || '_none';
  bump(byTenant, tenant, input.durationMs, isError);
}

export function getHttpMetricsSnapshot(): {
  uptimeMs: number;
  routes: Array<{ key: string; count: number; errors: number; avgDurationMs: number }>;
  tenants: Array<{ companyId: string; count: number; errors: number; avgDurationMs: number }>;
} {
  const mapToList = (map: Map<string, Bucket>, idKey: 'key' | 'companyId') =>
    [...map.entries()]
      .map(([k, v]) => ({
        [idKey]: k,
        count: v.count,
        errors: v.errors,
        avgDurationMs: v.count ? Math.round(v.totalDurationMs / v.count) : 0,
      }))
      .sort((a, b) => (b.count as number) - (a.count as number))
      .slice(0, 50) as Array<{
      key?: string;
      companyId?: string;
      count: number;
      errors: number;
      avgDurationMs: number;
    }>;

  return {
    uptimeMs: Date.now() - startedAt,
    routes: mapToList(byPath, 'key') as Array<{
      key: string;
      count: number;
      errors: number;
      avgDurationMs: number;
    }>,
    tenants: mapToList(byTenant, 'companyId') as Array<{
      companyId: string;
      count: number;
      errors: number;
      avgDurationMs: number;
    }>,
  };
}

/** Testes / reinício controlado. */
export function resetHttpMetricsForTests(): void {
  byPath.clear();
  byTenant.clear();
  startedAt = Date.now();
}
