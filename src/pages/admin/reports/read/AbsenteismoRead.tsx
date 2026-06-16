import { observabilityConsole } from '../../../../shared/logger/observabilityConsole';
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { db, isSupabaseConfigured } from '../../../../services/supabaseClient';
import { LoadingState } from '../../../../../components/UI';
import { ReportReadShell } from './ReportReadShell';
import { buildEmployeeNameMap, nameFromMap } from '../reportEmployeeLookup';
import { fetchEmployees } from '../../../../services/employeesApi.service';

type Row = { id: string; user_id: string; nome: string; absence_date: string; type: string; reason: string };

export function AbsenteismoRead() {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) {
      setLoadingData(false);
      return;
    }
    let c = false;
    (async () => {
      setLoadingData(true);
      try {
        const cid = user.companyId!;
        const [apiEmployees, users] = await Promise.all([
          fetchEmployees(cid),
          db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }], {
            columns: 'id',
            limit: 1000,
          }) as Promise<{ id?: string }[]>,
        ]);
        const companyUserIds = new Set<string>();
        for (const u of users ?? []) {
          const id = String(u.id ?? '').trim();
          if (id) companyUserIds.add(id);
        }
        for (const e of apiEmployees) {
          if (e.id) companyUserIds.add(e.id);
        }

        const abs = (await db.select(
          'absences',
          [],
          { column: 'absence_date', ascending: false },
          2000,
        )) as any[];

        if (c) return;
        const nameMap = await buildEmployeeNameMap(cid, apiEmployees);
        setRows(
          (abs ?? [])
            .filter((r: any) => companyUserIds.has(String(r.user_id ?? '')))
            .map((r: any) => ({
              id: r.id,
              user_id: r.user_id,
              nome: nameFromMap(nameMap, r.user_id),
              absence_date: r.absence_date,
              type: r.type ?? '—',
              reason: r.reason ?? '—',
            })),
        );
      } catch (e) {
        observabilityConsole.error(e);
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
    <ReportReadShell title="Absenteísmo" subtitle="Registros de ausência (leitura).">
      {loadingData ? (
        <LoadingState message="Carregando..." />
      ) : rows.length === 0 ? (
        <p className="text-slate-500 text-center py-10">Nenhum registro de ausência.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-left text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Colaborador</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.absence_date}</td>
                  <td className="px-3 py-2">{r.nome}</td>
                  <td className="px-3 py-2">{r.type}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportReadShell>
  );
}
