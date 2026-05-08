import { isImpossibleMovement } from './geoDistance.service';

export type GeoSnapshot = {
  latitude_original: number;
  longitude_original: number;
  accuracy_meters: number | null;
  captured_at: string;
  provider: string;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  geocode_source: string | null;
  reverse_geocode_version: string | null;
};

export type GeoValidationIssue =
  | 'invalid_range'
  | 'possible_inversion'
  | 'low_accuracy'
  | 'very_low_accuracy'
  | 'impossible_movement';

export type GeoValidationResult = {
  valid: boolean;
  issues: GeoValidationIssue[];
};

type GeoContext = {
  employeeId: string;
  source: string;
};

function logGeo(tag: string, payload: Record<string, unknown>): void {
  if (typeof console === 'undefined') return;
  console.info(tag, payload);
}

export function validateCoordinateOrder(lat: number, lng: number): GeoValidationIssue[] {
  const issues: GeoValidationIssue[] = [];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    issues.push('invalid_range');
  }
  if (Math.abs(lat) > 30 && Math.abs(lat) < 45 && Math.abs(lng) > 5 && Math.abs(lng) < 20) {
    issues.push('possible_inversion');
  }
  return issues;
}

export function validateGeoSnapshot(
  snapshot: GeoSnapshot,
  ctx: GeoContext,
  previous?: { lat: number; lng: number; instantMs: number } | null,
): GeoValidationResult {
  const issues: GeoValidationIssue[] = [];
  const coordIssues = validateCoordinateOrder(snapshot.latitude_original, snapshot.longitude_original);
  issues.push(...coordIssues);
  const acc = Number(snapshot.accuracy_meters ?? Number.NaN);
  if (Number.isFinite(acc) && acc > 100) issues.push('low_accuracy');
  if (Number.isFinite(acc) && acc > 300) issues.push('very_low_accuracy');

  const currentMs = new Date(snapshot.captured_at).getTime();
  if (previous && Number.isFinite(currentMs)) {
    const mv = isImpossibleMovement(
      { latitude: previous.lat, longitude: previous.lng },
      { latitude: snapshot.latitude_original, longitude: snapshot.longitude_original },
      previous.instantMs,
      currentMs,
    );
    if (mv.impossible) {
      issues.push('impossible_movement');
      logGeo('[GEO IMPOSSIBLE MOVEMENT]', {
        employee_id: ctx.employeeId,
        source: ctx.source,
        meters: Math.round(mv.meters),
      });
    }
  }

  if (coordIssues.length > 0) {
    logGeo('[GEO INVALID COORDINATE ORDER]', {
      employee_id: ctx.employeeId,
      source: ctx.source,
      lat: snapshot.latitude_original,
      lng: snapshot.longitude_original,
      issues: coordIssues,
    });
  }

  if (issues.includes('low_accuracy') || issues.includes('very_low_accuracy')) {
    logGeo('[GEO LOW ACCURACY]', {
      employee_id: ctx.employeeId,
      source: ctx.source,
      accuracy: snapshot.accuracy_meters,
      provider: snapshot.provider,
    });
  }

  return { valid: !issues.includes('invalid_range'), issues };
}

