import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { db, isSupabaseConfigured, type Filter } from '../../../../services/supabaseClient';
import { LoadingState } from '../../../../../components/UI';
import { ReportReadShell } from './ReportReadShell';

type CiclicaRow = {
  id: string;
  name: string;
  data_base: string;
  controlar_dsr: boolean;
  ciclos: { shift_id: string; duracao_dias: number }[];
};

export function EscalasCiclicasRead() {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<CiclicaRow[]>([]);
  const [shiftNames, setShiftNames] = useState<Map<string, string>>(new Map());
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) {
      setLoadingData(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingData(true);
      try {
        const filters: Filter[] = [{ column: 'company_id', operator: 'eq', value: user.companyId }];
        const [ciclicas, shifts] = await Promise.all([
          db.select('escala_ciclica', filters).catch(() => []) as Promise<any[]>,
          db.select('work_shifts', filters) as Promise<any[]>,
        ]);
        if (cancelled) return;
        const sm = new Map((shifts ?? []).map((s: any) => [s.id, s.name ?? s.description ?? '—']));
        setShiftNames(sm);
        setRows(
          (ciclicas ?? []).map((r: any) => ({
            id: r.id,
            name: r.name ?? '—',
            data_base: (r.data_base || '').slice(0, 10),
            controlar_dsr: !!r.controlar_dsr,
            ciclos: Array.isArray(r.ciclos) ? r.ciclos : [],
          })),
        );
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId]);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <ReportReadShell title="Escalas cíclicas" subtitle="Leitura das escalas cíclicas cadastradas.">
      {loadingData ? (
        <LoadingState message="Carregando escalas..." />
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-500 py-12">Nenhuma escala cíclica cadastrada.</p>
      ) : (
        <div className="space-y-6">
          {rows.map((r) => (
            <article key={r.id} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2 border-b border-slate-200 dark:border-slate-600">
                <p className="font-bold text-slate-900 dark:text-white">{r.name}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Data base: {r.data_base || '—'} · DSR: {r.controlar_dsr ? 'Sim' : 'Não'}
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700 text-white text-xs">
                    <th className="text-left px-3 py-2">Ordem</th>
                    <th className="text-left px-3 py-2">Horário</th>
                    <th className="text-right px-3 py-2">Dias</th>
                  </tr>
                </thead>
                <tbody>
                  {r.ciclos.map((c, i) => (
                    <tr key={`${r.id}-${i}`} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2">{shiftNames.get(c.shift_id) ?? c.shift_id?.slice(0, 8) ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.duracao_dias ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ))}
        </div>
      )}
    </ReportReadShell>
  );
}
