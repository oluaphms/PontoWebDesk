import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { db, isSupabaseConfigured, type Filter } from '../../../../services/supabaseClient';
import { LoadingState } from '../../../../../components/UI';
import { ReportReadShell } from './ReportReadShell';

type U = { id: string; nome: string | null; email: string | null; role: string | null };

export function FuncionariosRead() {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<U[]>([]);
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
        const data = (await db.select('users', filters)) as any[];
        if (c) return;
        setRows(
          (data ?? []).map((r: any) => ({
            id: r.id,
            nome: r.nome ?? null,
            email: r.email ?? null,
            role: r.role ?? null,
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
    <ReportReadShell title="Funcionários" subtitle="Listagem somente leitura dos colaboradores da empresa.">
      {loadingData ? (
        <LoadingState message="Carregando..." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-left text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">E-mail</th>
                <th className="px-3 py-2">Papel</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-slate-900 dark:text-white">{r.nome || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{r.email || '—'}</td>
                  <td className="px-3 py-2">{r.role || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportReadShell>
  );
}
