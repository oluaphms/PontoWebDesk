/**
 * Detecção de mudança de payload GEO com mesmo instante aparente.
 * O valor canônico vem do banco (`geo_snapshot_checksum`, md5 na migração SQL).
 */

export type GeoSnapshotChecksumParts = {
  lat: number | null | undefined;
  lng: number | null | undefined;
  accuracy: number | null | undefined;
  captured_at: string | null | undefined;
  state_version: number | null | undefined;
};

/** `true` se ambos existem e divergem (entre dois fetches autoritativos). */
export function geoSnapshotChecksumChanged(
  previous: string | null | undefined,
  incoming: string | null | undefined,
): boolean {
  const a = String(previous ?? '').trim();
  const b = String(incoming ?? '').trim();
  if (!a || !b) return false;
  return a !== b;
}
