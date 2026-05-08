export type GeoPoint = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_M = 6371000;

function toRad(v: number): number {
  return (v * Math.PI) / 180;
}

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isImpossibleMovement(
  prev: GeoPoint,
  next: GeoPoint,
  prevInstantMs: number,
  nextInstantMs: number,
  maxMeters = 300,
  windowMs = 60 * 1000,
): { impossible: boolean; meters: number } {
  const dt = Math.abs(nextInstantMs - prevInstantMs);
  const meters = distanceMeters(prev, next);
  return { impossible: dt <= windowMs && meters > maxMeters, meters };
}
