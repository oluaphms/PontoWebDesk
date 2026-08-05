import React, { useEffect, useState } from 'react';
import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
import { AdminPunchPhotoViewer, resolvePunchPhotoUrl } from '../../../components/AdminPunchPhotoViewer';
import { reverseGeocodeSnapshot, type GeocodeSnapshot } from '../../../services/geolocation/reverseGeocode.service';
import { extractLatLng } from '../../../utils/reverseGeocode';
import {
  formatPunchGeoLines,
  hasPersistedGeoAddress,
  readGeoAddressFromRecord,
  readGeoAccuracy,
} from '../../../utils/punchGeoDisplay';

export type TimesheetGeoRecord = {
  id: string;
  user_id: string;
  created_at: string;
  timestamp?: string | null;
  type: string;
  manual_reason?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  location?: unknown;
  raw_data?: Record<string, unknown> | null;
  metadata?: unknown;
  is_manual?: boolean;
  source?: string | null;
  method?: string | null;
  origin?: string | null;
  source_type?: string | null;
};

function recordWithGeocodeSnapshot(record: TimesheetGeoRecord, snapshot: GeocodeSnapshot): TimesheetGeoRecord {
  const prevRaw =
    record.raw_data && typeof record.raw_data === 'object' && !Array.isArray(record.raw_data)
      ? (record.raw_data as Record<string, unknown>)
      : {};
  const prevSnap =
    prevRaw.geo_snapshot && typeof prevRaw.geo_snapshot === 'object' && !Array.isArray(prevRaw.geo_snapshot)
      ? (prevRaw.geo_snapshot as Record<string, unknown>)
      : {};
  return {
    ...record,
    raw_data: {
      ...prevRaw,
      geo_snapshot: {
        ...prevSnap,
        formatted_address: snapshot.formatted_address ?? snapshot.formatted,
        street: snapshot.street,
        district: snapshot.district,
        city: snapshot.city,
        state: snapshot.state,
        postal_code: snapshot.postal_code,
        geocode_snapshot: snapshot,
      },
    },
  };
}

function formatPunchPhotoLabel(record: TimesheetGeoRecord): string {
  const iso = record.created_at || (record as { timestamp?: string }).timestamp;
  if (!iso) return 'Ver foto';
  try {
    return new Date(String(iso)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Ver foto';
  }
}

function PunchPhotoInGeoDetails({ record }: { record: TimesheetGeoRecord }) {
  const photoUrl = resolvePunchPhotoUrl(record);
  if (!photoUrl) return null;
  return (
    <div className="mt-1">
      <AdminPunchPhotoViewer photoUrl={photoUrl} label={formatPunchPhotoLabel(record)} />
    </div>
  );
}

export function GeoDetailsToggle({
  record,
  notApplicable,
}: {
  record: TimesheetGeoRecord;
  notApplicable: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loadingGeo, setLoadingGeo] = useState(false);
  const [geo, setGeo] = useState<GeocodeSnapshot | null>(null);

  const ll = extractLatLng(record);
  const lat = ll?.lat ?? null;
  const lng = ll?.lng ?? null;
  const hasAddress = hasPersistedGeoAddress(record);
  const accuracy = readGeoAccuracy(record);

  useEffect(() => {
    let cancelled = false;
    if (lat == null || lng == null || geo || hasAddress) return;
    setLoadingGeo(true);
    void reverseGeocodeSnapshot(lat, lng)
      .then(({ snapshot }) => {
        if (!cancelled) setGeo(snapshot);
      })
      .catch((error) => {
        observabilityConsole.error('[GEO ESPELHO ENRICH ERROR]', error);
      })
      .finally(() => {
        if (!cancelled) setLoadingGeo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, geo, hasAddress]);

  const addressLines = hasAddress
    ? formatPunchGeoLines(record)
    : geo
      ? formatPunchGeoLines(recordWithGeocodeSnapshot(record, geo))
      : [];

  const displayLines =
    addressLines.length > 0
      ? addressLines
      : loadingGeo
        ? []
        : lat != null && lng != null
          ? [`${lat.toFixed(6)}`, `${lng.toFixed(6)}`]
          : [];

  const geoQuality =
    accuracy == null || !Number.isFinite(accuracy)
      ? null
      : accuracy > 300
        ? 'GPS degradado'
        : accuracy > 100
          ? 'Localização aproximada'
          : null;

  if (lat == null && lng == null) {
    if (hasAddress) {
      const lines = formatPunchGeoLines(record);
      return (
        <div className="space-y-0.5">
          <div className="text-[10px] text-slate-600 dark:text-slate-300">
            <span className="font-semibold">GPS:</span>
            <div className="mt-0.5 space-y-0.5 break-words">
              {lines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
            <PunchPhotoInGeoDetails record={record} />
          </div>
        </div>
      );
    }
    return (
      <div className="text-[10px] text-slate-500 dark:text-slate-400">
        <span className="font-semibold">GPS:</span>{' '}
        {notApplicable ? 'não se aplica (Relógio REP)' : '—'}
        <PunchPhotoInGeoDetails record={record} />
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-slate-600 dark:text-slate-300">
        <span className="font-semibold">GPS:</span>
        {loadingGeo && displayLines.length === 0 ? (
          <span className="ml-1 text-slate-500">Resolvendo endereço...</span>
        ) : (
          <div className="mt-0.5 space-y-0.5 break-words">
            {displayLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        )}
        <PunchPhotoInGeoDetails record={record} />
      </div>
      {geoQuality && (
        <span className="inline-flex text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          {geoQuality}
        </span>
      )}
      {(hasAddress || geo || (lat != null && lng != null)) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-indigo-600 dark:text-indigo-300 hover:underline"
        >
          {expanded ? 'Menos detalhes' : 'Mais detalhes'}
        </button>
      )}
      {expanded && (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 space-y-0.5">
          {lat != null && lng != null && (
            <div className="tabular-nums">
              {lat.toFixed(6)}, {lng.toFixed(6)}
            </div>
          )}
          {(() => {
            const formattedAddress = geo?.formatted_address ?? geo?.formatted ?? readGeoAddressFromRecord(record).formattedAddress;
            const street = geo?.street ?? readGeoAddressFromRecord(record).street;
            const shouldShowStreet = Boolean(
              street && (!formattedAddress || !formattedAddress.toLowerCase().includes(street.toLowerCase())),
            );
            return (
              <>
              {formattedAddress && (
                <div>
                  <span className="font-semibold">Endereço:</span> <span>{formattedAddress}</span>
                </div>
              )}
              {shouldShowStreet && (
                <div>
                  <span className="font-semibold">Rua:</span> <span>{street}</span>
                </div>
              )}
              {geo?.district && (
                <div>
                  <span className="font-semibold">Bairro:</span> <span>{geo.district}</span>
                </div>
              )}
              {geo?.postal_code && (
                <div>
                  <span className="font-semibold">CEP:</span> <span>{geo.postal_code}</span>
                </div>
              )}
              {(geo?.city || geo?.state) && (
                <div>
                  <span className="font-semibold">Cidade/UF:</span> <span>{geo?.city ?? ''}{geo?.state ? `/${geo.state}` : ''}</span>
                </div>
              )}
            </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
