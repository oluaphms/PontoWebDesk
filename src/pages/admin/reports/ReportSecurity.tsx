/**
import { Navigate } from 'react-router-dom';
 * Relatório de Segurança / Antifraude – registros suspeitos, funcionários, localização, score.
 */

import React, { useEffect, useState } from 'react';
import { ShieldAlert, FileDown } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { LoadingState } from '../../../../components/UI';
import { Button } from '../../../../components/UI';

const FLAG_LABELS: Record<string, string> = {
  location_violation: 'Local fora da área',
  device_unknown: 'Dispositivo não reconhecido',
  face_mismatch: 'Face não confere',
  behavior_anomaly: 'Anomalia comportamental',
};

export default function ReportSecurity() {
  const { user, loading } = useCurrentUser();
  const [records, setRecords] = useState<any[]>([]);
  const [employees, setEmployees] = useState<Map<string, string>>(new Map());
  const [periodStart, setPeriodStart] = useState(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [onlySuspicious, setOnlySuspicious] = useState(true);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;

    const load = async () => {
      setLoadingData(true);
      try {
        const [recs, usersRows] = await Promise.all([
          db.select(
            'time_records',
            [{ column: 'company_id', operator: 'eq', value: user.companyId }],
            { column: 'created_at', ascending: false },
            5000
          ) as Promise<any[]>,
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);

        const empMap = new Map<string, string>();
        (usersRows ?? []).forEach((u: any) => empMap.set(u.id, u.nome || u.email || u.id?.slice(0, 8)));
        setEmployees(empMap);

        let list = (recs ?? []).filter((r: any) => {
          const d = (r.created_at || r.timestamp || '').toString().slice(0, 10);
          return d >= periodStart && d <= periodEnd;
        });
        if (onlySuspicious) {
          list = list.filter((r: any) => r.fraud_score != null && Number(r.fraud_score) > 50);
        }
        setRecords(list);
      } finally {
        setLoadingData(false);
      }
    };

    load();
  }, [user?.companyId, periodStart, periodEnd, onlySuspicious]);

  const exportCsv = () => {
    const headers = ['Data', 'Hora', 'Funcionário', 'Tipo', 'Score', 'Flags', 'Lat', 'Lon'];
    const rows = records.map((r) => {
      const dt = new Date(r.timestamp || r.created_at);
      const flags = Array.isArray(r.fraud_flags) ? r.fraud_flags : [];
      return [
        dt.toLocaleDateString('pt-BR'),
        dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        employees.get(r.user_id) || r.user_id?.slice(0, 8),
        r.type,
        r.fraud_score ?? '',
        flags.map((f: string) => FLAG_LABELS[f] || f).join('; '),
        r.latitude ?? '',
        r.longitude ?? '',
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio-seguranca-${periodStart}-${periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Segurança (Antifraude)"
        subtitle="Registros suspeitos, score de fraude e localização"
        icon={<ShieldAlert className="w-5 h-5" />}
      />

      <div className="flex flex-wrap gap-4 items-center">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600 dark:text-slate-400">De</span>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600 dark:text-slate-400">Até</span>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlySuspicious}
            onChange={(e) => setOnlySuspicious(e.target.checked)}
          />
          Apenas suspeitos (score &gt; 50)
        </label>
        <Button onClick={exportCsv} disabled={records.length === 0}>
          <FileDown className="w-4 h-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      {loadingData ? (
        <LoadingState message="Carregando..." />
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50">
              <tr>
                <th className="text-left p-3">Data</th>
                <th className="text-left p-3">Hora</th>
                <th className="text-left p-3">Funcionário</th>
                <th className="text-left p-3">Tipo</th>
                <th className="text-right p-3">Score</th>
                <th className="text-left p-3">Flags</th>
                <th className="text-left p-3">Localização</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4 text-slate-500 dark:text-slate-400 text-center">
                    Nenhum registro no período.
                  </td>
                </tr>
              ) : (
                records.map((r) => {
                  const dt = new Date(r.timestamp || r.created_at);
                  const flags = Array.isArray(r.fraud_flags) ? r.fraud_flags : [];
                  return (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="p-3">{dt.toLocaleDateString('pt-BR')}</td>
                      <td className="p-3">{dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                      <td className="p-3">{employees.get(r.user_id) || r.user_id?.slice(0, 8)}</td>
                      <td className="p-3">{r.type}</td>
                      <td className="p-3 text-right font-mono">{r.fraud_score ?? '—'}</td>
                      <td className="p-3">{flags.map((f: string) => FLAG_LABELS[f] || f).join(', ') || '—'}</td>
                      <td className="p-3">
                        {r.latitude != null && r.longitude != null
                          ? `${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}`
                          : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
