import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { db, isSupabaseConfigured, type Filter } from '../../../../services/supabaseClient';
import { LoadingState } from '../../../../../components/UI';
import { ReportReadShell } from './ReportReadShell';

type Row = {
  id: string;
  colaborador_nome: string;
  horario_nome: string | null;
  escala_nome: string | null;
  data_inicio: string;
  data_fim: string | null;
  ativo: boolean;
};

export function HistoricoHorariosRead() {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<Row[]>([]);
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
        const raw = (await db.select('colaborador_jornada', filters).catch(() => [])) as any[];
        const users = (await db.select('users', filters)) as any[];
        const shifts = (await db.select('work_shifts', filters)) as any[];
        const schedules = (await db.select('schedules', filters)) as any[];
        if (c) return;
        const um = new Map(users.map((u: any) => [u.id, u.nome || u.email]));
        const hm = new Map(shifts.map((s: any) => [s.id, s.name]));
        const em = new Map(schedules.map((s: any) => [s.id, s.name]));
        setRows(
          (raw ?? []).map((r: any) => ({
            id: r.id,
            colaborador_nome: um.get(r.colaborador_id) ?? '—',
            horario_nome: r.horario_id ? hm.get(r.horario_id) ?? null : null,
            escala_nome: r.escala_id ? em.get(r.escala_id) ?? null : null,
            data_inicio: (r.data_inicio || '').slice(0, 10),
            data_fim: r.data_fim ? String(r.data_fim).slice(0, 10) : null,
            ativo: !!r.ativo,
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
    <ReportReadShell title="Histórico de horários" subtitle="Vinculação de jornada e escalas por colaborador (leitura).">
      {loadingData ? (
        <LoadingState message="Carregando..." />
      ) : rows.length === 0 ? (
        <p className="text-slate-500 text-center py-10">Nenhum vínculo registrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 text-sm">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-left text-xs font-bold uppercase text-slate-600 dark:text-slate-300">
                <th className="px-3 py-2">Colaborador</th>
                <th className="px-3 py-2">Horário</th>
                <th className="px-3 py-2">Escala</th>
                <th className="px-3 py-2">Início</th>
                <th className="px-3 py-2">Fim</th>
                <th className="px-3 py-2">Ativo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">{r.colaborador_nome}</td>
                  <td className="px-3 py-2">{r.horario_nome ?? '—'}</td>
                  <td className="px-3 py-2">{r.escala_nome ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{r.data_inicio}</td>
                  <td className="px-3 py-2 tabular-nums">{r.data_fim ?? '—'}</td>
                  <td className="px-3 py-2">{r.ativo ? 'Sim' : 'Não'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportReadShell>
  );
}
