import React, { useEffect, useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { FileDown } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { calculateWorkedHours } from '../../utils/timeCalculations';

function formatLocation(loc: { lat?: number; lng?: number } | null | undefined): string {
  if (!loc || loc.lat == null || loc.lng == null) return '—';
  return `${Number(loc.lat).toFixed(4)}, ${Number(loc.lng).toFixed(4)}`;
}

const EmployeeTimesheet: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [records, setRecords] = useState<any[]>([]);
  const [periodStart, setPeriodStart] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;
    const load = async () => {
      setLoadingData(true);
      try {
        const rows = (await db.select('time_records', [{ column: 'user_id', operator: 'eq', value: user.id }], { column: 'created_at', ascending: false }, 500)) as any[];
        setRecords(rows ?? []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, [user?.id]);

  const filtered = useMemo(() => {
    return records.filter((r: any) => {
      const d = (r.created_at || '').slice(0, 10);
      return d >= periodStart && d <= periodEnd;
    });
  }, [records, periodStart, periodEnd]);

  const byDate = useMemo(() => {
    const map = new Map<string, { entrance?: string; exit?: string; breakStart?: string; breakEnd?: string; worked: string; status: string; location?: string }>();
    const sorted = [...filtered].sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''));
    sorted.forEach((r: any) => {
      const d = (r.created_at || '').slice(0, 10);
      const time = r.created_at ? new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
      const cur = map.get(d) || { worked: '', status: 'OK' };
      if (r.type === 'entrada') cur.entrance = time;
      else if (r.type === 'saída') cur.exit = time;
      else if (r.type === 'pausa') {
        if (!cur.breakStart) cur.breakStart = time;
        else cur.breakEnd = time;
      }
      if (r.location && cur.location == null) cur.location = formatLocation(r.location);
      map.set(d, cur);
    });
    map.forEach((sum, d) => {
      if (sum.entrance && sum.exit) {
        const a = new Date(`${d}T${sum.entrance}`);
        const b = new Date(`${d}T${sum.exit}`);
        let mins = (b.getTime() - a.getTime()) / 60000;
        if (sum.breakStart && sum.breakEnd) {
          const br = (new Date(`${d}T${sum.breakEnd}`).getTime() - new Date(`${d}T${sum.breakStart}`).getTime()) / 60000;
          mins -= br;
        }
        const h = Math.floor(mins / 60);
        const m = Math.round(mins % 60);
        sum.worked = `${h}h ${m}m`;
      }
    });
    return map;
  }, [filtered]);

  const dates = useMemo(() => [...new Set(filtered.map((r: any) => (r.created_at || '').slice(0, 10)))].sort().reverse(), [filtered]);

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
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Entrada</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Saída</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Intervalo</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horas Trabalhadas</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Localização</th>
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => {
                const sum = byDate.get(d) || {};
                return (
                  <tr key={d} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{d}</td>
                    <td className="px-4 py-3 tabular-nums">{sum.entrance || '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{sum.exit || '—'}</td>
                    <td className="px-4 py-3">{sum.breakStart && sum.breakEnd ? `${sum.breakStart} - ${sum.breakEnd}` : '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{sum.worked || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs font-mono">{sum.location ?? '—'}</td>
                    <td className="px-4 py-3">{sum.status || 'OK'}</td>
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
