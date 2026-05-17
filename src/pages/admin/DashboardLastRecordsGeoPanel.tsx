import React, { memo, useEffect, useState } from 'react';
import { CalendarDays, ArrowRight } from 'lucide-react';
import type { AdminDashboardLastRecord } from '../../services/dashboard.service';
import { i18n } from '../../../lib/i18n';
import { reverseGeocodeSnapshot } from '../../services/geolocation/reverseGeocode.service';
import { validateCoordinateOrder } from '../../services/geolocation/geoIntegrity.service';
import { isDegradedMobileRuntime } from '../../performance/mobileCpuBudget';
import { isRestrictedBootstrapMode } from '../../performance/networkMode';
import { opLog } from '../../utils/operationalLogger';

type ResolvedAddress = {
  status: 'loading' | 'resolved' | 'unresolved' | 'timeout' | 'error';
  street: string | null;
  district: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
  formattedAddress: string | null;
};

export interface DashboardLastRecordsGeoPanelProps {
  lastRecords: AdminDashboardLastRecord[];
  deferredHeavyInit: boolean;
  onNavigateTimesheet: () => void;
}

const DashboardLastRecordsGeoPanel = memo(function DashboardLastRecordsGeoPanel({
  lastRecords,
  deferredHeavyInit,
  onNavigateTimesheet,
}: DashboardLastRecordsGeoPanelProps) {
  const [resolvedAddressByRecord, setResolvedAddressByRecord] = useState<Record<string, ResolvedAddress>>({});
  const [gpsDetailsExpandedByRecord, setGpsDetailsExpandedByRecord] = useState<Record<string, boolean>>({});
  const activeGeoRequests = new Set<string>();

  useEffect(() => {
    if (!deferredHeavyInit) return;
    let cancelled = false;
    const degraded = isDegradedMobileRuntime() || isRestrictedBootstrapMode();
    const recordsWithGeo = lastRecords.filter((r) => r.lat != null && r.lng != null);
    opLog.info('GEO DASHBOARD ENRICH START', {
      total_records: lastRecords.length,
      records_with_geo: recordsWithGeo.length,
      degraded_mobile_skip_network: degraded,
    });
    if (recordsWithGeo.length === 0) {
      setResolvedAddressByRecord({});
      return () => {
        cancelled = true;
      };
    }

    setResolvedAddressByRecord((prev) => {
      const next: typeof prev = {};
      for (const r of recordsWithGeo) {
        if (r.geoStreet || r.geoDistrict || r.geoPostalCode || r.geoCity || r.geoState) {
          next[r.id] = {
            status: 'resolved',
            street: r.geoStreet,
            district: r.geoDistrict,
            postalCode: r.geoPostalCode,
            city: r.geoCity,
            state: r.geoState,
            formattedAddress: r.streetAddress,
          };
        } else {
          next[r.id] = prev[r.id] ?? {
            status: degraded ? 'unresolved' : 'loading',
            street: null,
            district: null,
            postalCode: null,
            city: null,
            state: null,
            formattedAddress: null,
          };
        }
      }
      return next;
    });

    if (degraded) {
      opLog.diag('GEO DASHBOARD ENRICH PENDING', {
        reason: 'degraded_mobile_cpu',
        unresolved_skipped: recordsWithGeo.length,
      });
      return () => {
        cancelled = true;
      };
    }

    const unresolved = recordsWithGeo.filter(
      (r) => !(r.geoStreet || r.geoDistrict || r.geoPostalCode || r.geoCity || r.geoState),
    );
    opLog.diag('GEO DASHBOARD ENRICH PENDING', {
      unresolved_count: unresolved.length,
      unresolved_record_ids: unresolved.map((r) => r.id),
    });

    void (async () => {
      for (let i = 0; i < unresolved.length; i += 1) {
        const r = unresolved[i];
        try {
          if (cancelled) {
            if (import.meta.env.DEV) {
              opLog.diag('GEO ENRICH SKIPPED', {
                reason: 'stale_request_cancelled',
                record_id: r.id,
                employee_id: r.userId,
              });
            }
            break;
          }
          if (!navigator.onLine) {
            if (import.meta.env.DEV) {
              opLog.diag('GEO ENRICH SKIPPED', {
                reason: 'offline',
                record_id: r.id,
                employee_id: r.userId,
                lat: r.lat,
                lng: r.lng,
              });
            }
            setResolvedAddressByRecord((prev) => ({
              ...prev,
              [r.id]: {
                status: 'error',
                street: null,
                district: null,
                postalCode: null,
                city: null,
                state: null,
                formattedAddress: null,
              },
            }));
            continue;
          }
          const coordIssues = validateCoordinateOrder(Number(r.lat), Number(r.lng));
          if (coordIssues.includes('invalid_range')) {
            setResolvedAddressByRecord((prev) => ({
              ...prev,
              [r.id]: {
                status: 'error',
                street: null,
                district: null,
                postalCode: null,
                city: null,
                state: null,
                formattedAddress: null,
              },
            }));
            continue;
          }
          activeGeoRequests.add(r.id);
          const { snapshot } = await reverseGeocodeSnapshot(Number(r.lat), Number(r.lng));
          activeGeoRequests.delete(r.id);
          if (cancelled) break;
          setResolvedAddressByRecord((prev) => ({
            ...prev,
            [r.id]: {
              status:
                snapshot.reverse_geocode_status === 'timeout'
                  ? 'timeout'
                  : snapshot.reverse_geocode_status === 'provider_error'
                    ? 'error'
                    : snapshot.street || snapshot.district || snapshot.postal_code || snapshot.city || snapshot.state
                      ? 'resolved'
                      : 'unresolved',
              street: snapshot.street ?? null,
              district: snapshot.district ?? null,
              postalCode: snapshot.postal_code ?? null,
              city: snapshot.city ?? null,
              state: snapshot.state ?? null,
              formattedAddress: snapshot.formatted_address ?? snapshot.formatted ?? null,
            },
          }));
        } catch (error: unknown) {
          activeGeoRequests.delete(r.id);
          if (cancelled) break;
          setResolvedAddressByRecord((prev) => ({
            ...prev,
            [r.id]: {
              status: 'error',
              street: null,
              district: null,
              postalCode: null,
              city: null,
              state: null,
              formattedAddress: null,
            },
          }));
          opLog.diag('GEO DASHBOARD ENRICH ERROR', error);
        }
        if (!cancelled && i < unresolved.length - 1) {
          await new Promise((res) => setTimeout(res, 140));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lastRecords, deferredHeavyInit]);

  const originBadgeClass = (originLabel: string) => {
    if (originLabel === 'Relógio') return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    if (originLabel === 'App') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  };

  const geoQuality = (accuracy: number | null) => {
    if (accuracy == null || !Number.isFinite(accuracy)) return null;
    if (accuracy > 300) return 'GPS degradado';
    if (accuracy > 100) return 'Localização aproximada';
    return null;
  };

  const shouldRenderStreetSeparately = (formattedAddress?: string | null, street?: string | null) => {
    if (!street) return false;
    if (!formattedAddress) return true;
    const duplicated = formattedAddress.toLowerCase().includes(street.toLowerCase());
    if (duplicated) {
      console.warn('[GEO DUPLICATE STREET DETECTED]', {
        formatted_address: formattedAddress,
        street,
      });
    }
    return !duplicated;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-1 gap-8">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-indigo-500" />
            {i18n.t('dashboard.lastRecords')}
          </h3>
          <button
            type="button"
            onClick={onNavigateTimesheet}
            className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
          >
            {i18n.t('dashboard.viewTimesheet')} <ArrowRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lastRecords.map((r) => {
            const resolvedAddress = resolvedAddressByRecord[r.id];
            const quality = geoQuality(r.accuracy);
            const mapHref =
              r.lat != null && r.lng != null ? `https://maps.google.com/?q=${r.lat},${r.lng}` : null;
            return (
              <article
                key={r.id}
                className="rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 space-y-2 overflow-hidden"
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-semibold text-slate-900 dark:text-white truncate">{r.employeeName}</h4>
                  <span className="text-xs px-2 py-1 rounded-md bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 shrink-0">
                    {r.typeLabel}
                  </span>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-300">
                  <span className="tabular-nums">{r.date}</span> às <span className="tabular-nums">{r.time}</span>
                </div>
                {r.hasTimeAnomaly && (
                  <div className="text-xs px-2 py-1 rounded-md bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 inline-flex w-fit">
                    Data inconsistente: {r.timeAnomalyReason ?? 'verificar origem da batida'}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-1 rounded-md ${originBadgeClass(r.originLabel)}`}>{r.originLabel}</span>
                  {quality && (
                    <span className="text-xs px-2 py-1 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      {quality}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {r.lat != null && r.lng != null && gpsDetailsExpandedByRecord[r.id] && (
                    <div className="mb-2 space-y-0.5">
                      {resolvedAddress?.formattedAddress && (
                        <div>
                          <span className="font-semibold">Endereço:</span>{' '}
                          <span className="break-words">{resolvedAddress.formattedAddress}</span>
                        </div>
                      )}
                      {(!resolvedAddress?.formattedAddress ||
                        shouldRenderStreetSeparately(resolvedAddress?.formattedAddress, resolvedAddress?.street)) && (
                        <div>
                          <span className="font-semibold">Rua:</span>{' '}
                          {resolvedAddress?.status === 'loading' ? (
                            <span>Resolvendo...</span>
                          ) : resolvedAddress?.street ? (
                            <span className="break-words">{resolvedAddress.street}</span>
                          ) : resolvedAddress?.status === 'resolved' &&
                            (resolvedAddress?.district ||
                              resolvedAddress?.city ||
                              resolvedAddress?.state ||
                              resolvedAddress?.postalCode) ? (
                            <span>Não disponível</span>
                          ) : (
                            <span className="text-amber-700 dark:text-amber-300">Falha temporária ao resolver endereço.</span>
                          )}
                        </div>
                      )}
                      {resolvedAddress?.district && (
                        <div>
                          <span className="font-semibold">Bairro:</span> <span>{resolvedAddress.district}</span>
                        </div>
                      )}
                      {resolvedAddress?.postalCode && (
                        <div>
                          <span className="font-semibold">CEP:</span> <span>{resolvedAddress.postalCode}</span>
                        </div>
                      )}
                      {(resolvedAddress?.city || resolvedAddress?.state) && (
                        <div>
                          <span className="font-semibold">Cidade/UF:</span>{' '}
                          <span>
                            {resolvedAddress?.city ?? ''}
                            {resolvedAddress?.state ? `/${resolvedAddress.state}` : ''}
                          </span>
                        </div>
                      )}
                      {resolvedAddress?.status === 'timeout' && (
                        <div className="text-amber-700 dark:text-amber-300">Falha temporária ao resolver endereço.</div>
                      )}
                      {resolvedAddress?.status === 'error' && (
                        <div className="text-amber-700 dark:text-amber-300">Falha temporária ao resolver endereço.</div>
                      )}
                    </div>
                  )}
                  {gpsDetailsExpandedByRecord[r.id] && (r.lat == null || r.lng == null) && (
                    <div className="mb-2 text-amber-700 dark:text-amber-300">
                      Registro sem geolocalização (lançado via desktop/admin).
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setGpsDetailsExpandedByRecord((prev) => ({
                        ...prev,
                        [r.id]: !prev[r.id],
                      }))
                    }
                    className="inline-flex items-center gap-1 text-left hover:underline"
                  >
                    <span className="font-semibold">GPS:</span>{' '}
                    <span className="break-all">{r.location === '—' ? '—' : r.location}</span>
                  </button>
                </div>
                {mapHref && (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Ver no mapa
                  </a>
                )}
              </article>
            );
          })}
          {lastRecords.length === 0 && (
            <p className="py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
              {i18n.t('dashboard.noRecentRecords')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

export default DashboardLastRecordsGeoPanel;
