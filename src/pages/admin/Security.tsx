/**
 * Dashboard Antifraude – registros suspeitos, alertas, mapa de registros.
 */

import { Navigate } from 'react-router-dom';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ShieldAlert, MapPin, AlertTriangle, User, Clock, FileText } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';

interface TimeRecordWithFraud {
  id: string;
  user_id: string;
  type: string;
  timestamp?: string;
  created_at: string;
  fraud_score?: number | null;
  fraud_flags?: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface FraudAlertRow {
  id: string;
  employee_id: string;
  time_record_id?: string;
  type: string;
  description?: string;
  severity: string;
  created_at: string;
}

const FLAG_LABELS: Record<string, string> = {
  location_violation: 'Local fora da área',
  device_unknown: 'Dispositivo não reconhecido',
  face_mismatch: 'Face não confere',
  behavior_anomaly: 'Anomalia comportamental',
};

function reasonFromFlag(flag: string): string {
  if (flag === 'behavior_anomaly') return 'Comportamento fora do padrão do colaborador.';
  if (flag === 'location_violation') return 'Registro fora da área autorizada.';
  if (flag === 'device_unknown') return 'Dispositivo não reconhecido para o colaborador.';
  if (flag === 'face_mismatch') return 'Biometria/foto não conferiu com o cadastro.';
  return FLAG_LABELS[flag] || flag;
}

function normalizeFraudFlags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function AdminSecurity() {
  const { user, loading } = useCurrentUser();
  const [suspiciousRecords, setSuspiciousRecords] = useState<TimeRecordWithFraud[]>([]);
  const [alerts, setAlerts] = useState<FraudAlertRow[]>([]);
  const [allRecordsWithLocation, setAllRecordsWithLocation] = useState<TimeRecordWithFraud[]>([]);
  const [employees, setEmployees] = useState<Map<string, string>>(new Map());
  const [loadingData, setLoadingData] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  const alertReasonsByRecord = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const a of alerts) {
      const tr = String(a.time_record_id || '').trim();
      if (!tr) continue;
      const msg = String(a.description || '').trim() || reasonFromFlag(a.type);
      if (!out.has(tr)) out.set(tr, []);
      const arr = out.get(tr)!;
      if (!arr.includes(msg)) arr.push(msg);
    }
    return out;
  }, [alerts]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;

    const load = async () => {
      setLoadingData(true);
      try {
        const [records, alertsRows, usersRows] = await Promise.all([
          db.select(
            'time_records',
            [{ column: 'company_id', operator: 'eq', value: user.companyId }],
            { column: 'created_at', ascending: false },
            2000
          ) as Promise<any[]>,
          db.select('fraud_alerts', [], { column: 'created_at', ascending: false }, 100) as Promise<any[]>,
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);

        const empMap = new Map<string, string>();
        (usersRows ?? []).forEach((u: any) => empMap.set(u.id, u.nome || u.email || u.id?.slice(0, 8)));
        setEmployees(empMap);

        const recs = (records ?? []) as TimeRecordWithFraud[];
        const withFlags = recs.map((r) => ({
          ...r,
          fraud_flags: normalizeFraudFlags(r.fraud_flags),
        }));
        setSuspiciousRecords(withFlags.filter((r) => r.fraud_score != null && Number(r.fraud_score) > 50));
        setAllRecordsWithLocation(withFlags.filter((r) => r.latitude != null && r.longitude != null));

        const alertList = (alertsRows ?? []).filter(
          (a: any) => empMap.has(a.employee_id) || !user.companyId
        );
        setAlerts(alertList);
      } finally {
        setLoadingData(false);
      }
    };

    load();
  }, [user?.companyId]);

  useEffect(() => {
    if (!mapRef.current || allRecordsWithLocation.length === 0) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const first = allRecordsWithLocation[0];
    const lat = Number(first.latitude);
    const lon = Number(first.longitude);
    const map = L.map(mapRef.current).setView([lat, lon], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);

    allRecordsWithLocation.slice(0, 200).forEach((r) => {
      const la = Number(r.latitude);
      const ln = Number(r.longitude);
      if (Number.isFinite(la) && Number.isFinite(ln)) {
        const score = r.fraud_score != null ? Number(r.fraud_score) : 0;
        const isSuspicious = score > 50;
        L.marker([la, ln], {
          icon: L.divIcon({
            className: 'custom-marker',
            html: `<span style="background:${isSuspicious ? '#dc2626' : '#16a34a'};color:white;padding:2px 6px;border-radius:4px;font-size:10px">${r.type?.slice(0, 1) || '?'}</span>`,
            iconSize: [24, 24],
          }),
        })
          .bindTooltip(`${r.type} - ${r.timestamp || r.created_at || ''} ${isSuspicious ? `(score ${score})` : ''}`)
          .addTo(map);
      }
    });

    mapInstanceRef.current = map;
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [allRecordsWithLocation]);

  const topByFraud = [...suspiciousRecords]
    .reduce<{ userId: string; total: number; max: number; count: number }[]>((acc, r) => {
      const existing = acc.find((x) => x.userId === r.user_id);
      const score = Number(r.fraud_score) || 0;
      if (existing) {
        existing.total += score;
        existing.max = Math.max(existing.max, score);
        existing.count += 1;
      } else {
        acc.push({ userId: r.user_id, total: score, max: score, count: 1 });
      }
      return acc;
    }, [])
    .sort((a, b) => b.max - a.max)
    .slice(0, 10);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Segurança e Antifraude"
        subtitle="Registros suspeitos, alertas e mapa de marcações"
        icon={<ShieldAlert className="w-5 h-5" />}
      />

      {loadingData ? (
        <LoadingState message="Carregando dados..." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-medium">
                <AlertTriangle className="w-5 h-5" />
                Registros suspeitos
              </div>
              <p className="text-2xl font-bold mt-1">{suspiciousRecords.length}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">fraud_score &gt; 50</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 font-medium">
                <FileText className="w-5 h-5" />
                Alertas recentes
              </div>
              <p className="text-2xl font-bold mt-1">{alerts.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 font-medium">
                <MapPin className="w-5 h-5" />
                Registros com localização
              </div>
              <p className="text-2xl font-bold mt-1">{allRecordsWithLocation.length}</p>
            </div>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
              <User className="w-5 h-5" />
              Funcionários com maior score de fraude
            </h2>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              {topByFraud.length === 0 ? (
                <p className="p-4 text-slate-500 dark:text-slate-400 text-sm">Nenhum registro suspeito no período.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50">
                    <tr>
                      <th className="text-left p-3">Funcionário</th>
                      <th className="text-right p-3">Maior score</th>
                      <th className="text-right p-3">Qtd. registros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topByFraud.map(({ userId, max, count }) => (
                      <tr key={userId} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="p-3">{employees.get(userId) || userId?.slice(0, 8)}</td>
                        <td className="p-3 text-right font-mono">{max}</td>
                        <td className="p-3 text-right">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Alertas recentes
            </h2>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              {alerts.length === 0 ? (
                <p className="p-4 text-slate-500 dark:text-slate-400 text-sm">Nenhum alerta.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50">
                    <tr>
                      <th className="text-left p-3">Data</th>
                      <th className="text-left p-3">Funcionário</th>
                      <th className="text-left p-3">Tipo</th>
                      <th className="text-left p-3">Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.slice(0, 20).map((a) => (
                      <tr key={a.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="p-3 text-slate-600 dark:text-slate-400">
                          {new Date(a.created_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="p-3">{employees.get(a.employee_id) || a.employee_id?.slice(0, 8)}</td>
                        <td className="p-3">{FLAG_LABELS[a.type] || a.type}</td>
                        <td className="p-3">{a.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Mapa de registros
            </h2>
            <div
              ref={mapRef}
              className="w-full h-[400px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Verde: registro normal. Vermelho: suspeito (score &gt; 50). Máx. 200 pontos.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Últimos registros suspeitos
            </h2>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="text-left p-3">Data/Hora</th>
                    <th className="text-left p-3">Funcionário</th>
                    <th className="text-left p-3">Tipo</th>
                    <th className="text-right p-3">Score</th>
                    <th className="text-left p-3">Flags</th>
                    <th className="text-left p-3">Motivos da anomalia</th>
                  </tr>
                </thead>
                <tbody>
                  {suspiciousRecords.slice(0, 30).map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="p-3">{new Date(r.timestamp || r.created_at).toLocaleString('pt-BR')}</td>
                      <td className="p-3">{employees.get(r.user_id) || r.user_id?.slice(0, 8)}</td>
                      <td className="p-3">{r.type}</td>
                      <td className="p-3 text-right font-mono">{r.fraud_score}</td>
                      <td className="p-3">
                        {(Array.isArray(r.fraud_flags) ? r.fraud_flags : []).map((f) => FLAG_LABELS[f] || f).join(', ') || '—'}
                      </td>
                      <td className="p-3 text-slate-700 dark:text-slate-300">
                        {(() => {
                          const fromAlerts = alertReasonsByRecord.get(r.id) || [];
                          if (fromAlerts.length) return fromAlerts.join(' | ');
                          const fromFlags = (Array.isArray(r.fraud_flags) ? r.fraud_flags : []).map((f) => reasonFromFlag(f));
                          if (fromFlags.length) return fromFlags.join(' | ');
                          return 'Score elevado sem motivo textual vinculado.';
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
