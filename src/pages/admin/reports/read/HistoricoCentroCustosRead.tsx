import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { db, isSupabaseConfigured, type Filter } from '../../../../services/supabaseClient';
import { LoadingState } from '../../../../../components/UI';
import { ReportReadShell } from './ReportReadShell';

export function HistoricoCentroCustosRead() {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<{ id: string; descricao: string; codigo: string }[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) {
      setLoadingData(false);
      return;
    }
    let c = false;
    (async () => {
      setLoadingData(true);
      try {
        const filters: Filter[] = [{ column: 'company_id', operator: 'eq', value: user.companyId }];
        const data = (await db.select('estruturas', filters)) as any[];
        if (c) return;
        setRows(
          (data ?? []).map((r: any) => ({
            id: r.id,
            descricao: r.descricao ?? r.nome ?? '—',
            codigo: r.codigo ?? '',
          })),
        );
      } catch (e) {
        console.error(e);
      } finally {
        if (!c) setLoadingData(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [user?.companyId]);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <ReportReadShell title="Histórico de centro de custos" subtitle='Estruturas / centros de custo cadastrados ("histórico" do cadastro).'>
      {loadingData ? (
        <LoadingState message="Carregando..." />
      ) : rows.length === 0 ? (
        <p className="text-slate-500 text-center py-10">Nenhuma estrutura cadastrada.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-left text-xs font-bold uppercase text-slate-600 dark:text-slate-300">
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2">Código</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">{r.descricao}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.codigo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportReadShell>
  );
}
