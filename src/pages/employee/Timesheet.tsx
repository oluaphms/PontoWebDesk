import React, { useEffect, useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { FileDown } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { buildDayMirrorSummary } from '../../utils/timesheetMirror';
import { extractLatLng } from '../../utils/reverseGeocode';
import { StreetAddress } from '../../components/StreetAddress';

const EmployeeTimesheet: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [records, setRecords] = useState<any[]>([]);
  const [periodStart, setPeriodStart] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    const load = async () => {
      setLoadingData(true);
      try {
        // Usa filtro de data no banco para reduzir carga e evitar dados de dias errados
        const startDate = periodStart;
        const endDate = periodEnd;
        const rows = (await db.select(
          'time_records',
          [
            { column: 'user_id', operator: 'eq', value: user.id },
            { column: 'created_at', operator: 'gte', value: `${startDate}T00:00:00` },
            { column: 'created_at', operator: 'lte', value: `${endDate}T23:59:59` },
          ],
          { column: 'created_at', ascending: false },
          500
        )) as any[];
        setRecords(rows ?? []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, [user?.id, periodStart, periodEnd]);

  // filtered removido - agora o filtro é feito diretamente na query do banco (mais rápido)

  const byDate = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof buildDayMirrorSummary> & { locationCoords?: { lat: number; lng: number } }
    >();
    const byDay = new Map<string, any[]>();
    records.forEach((r: any) => {
      const d = (r.created_at || '').slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(r);
    });
    byDay.forEach((arr, d) => {
      const mirror = buildDayMirrorSummary(arr);
      const locRow = arr.find((x: any) => extractLatLng(x));
      const locationCoords = locRow ? extractLatLng(locRow) ?? undefined : undefined;
      map.set(d, {
        ...mirror,
        locationCoords,
      });
    });
    return map;
  }, [records]);

  const dates = useMemo(() => [...new Set(records.map((r: any) => (r.created_at || '').slice(0, 10)))].sort().reverse(), [records]);

  const exportPDF = () => window.print();

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <PageHeader title="Espelho de Ponto" />

      <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 print:hidden">
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (início)</label>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (fim)</label>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
        </div>
        <button type="button" onClick={exportPDF} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
          <FileDown className="w-4 h-4" /> Exportar PDF
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-x-auto print:border-0 print:shadow-none print:bg-transparent print:overflow-visible">
        {loadingData ? (
          <div className="p-12 text-center text-slate-500">Carregando...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Data</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Entrada (início)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Intervalo (pausa)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Retorno</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Saída (final)</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horas trabalhadas</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Localização</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => {
                const sum = byDate.get(d);
                return (
                  <tr key={d} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{d}</td>
                    <td className="px-4 py-3 tabular-nums">{sum?.entradaInicio || '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{sum?.saidaIntervalo || '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{sum?.voltaIntervalo || '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{sum?.saidaFinal || '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{sum?.workedHours || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs max-w-[280px]">
                      {sum?.locationCoords ? (
                        <StreetAddress lat={sum.locationCoords.lat} lng={sum.locationCoords.lng} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">{sum?.status || 'OK'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!loadingData && dates.length === 0 && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum registro no período.</p>
        )}
      </div>
    </div>
  );
};

export default EmployeeTimesheet;
