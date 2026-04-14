import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { db, isSupabaseConfigured, type Filter } from '../../../../services/supabaseClient';
import { LoadingState, Button } from '../../../../../components/UI';
import type { WeeklyScheduleDay } from '../../../../../types';
import { ReportReadShell } from './ReportReadShell';

const DIA_SHORT = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

function blocoEntradaSaida(e: string, s: string, folga: boolean): string {
  if (folga) return '—';
  const a = (e || '').trim().slice(0, 5);
  const b = (s || '').trim().slice(0, 5);
  const lines: string[] = [];
  if (a) lines.push(`${a} - LIV`);
  if (b) lines.push(`${b} - LIV`);
  return lines.length ? lines.join('\n') : '—';
}

type ShiftLoad = {
  id: string;
  number: string;
  name: string;
  config?: { weekly_schedule?: WeeklyScheduleDay[] };
};

export function ListagemHorariosRead() {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<ShiftLoad[]>([]);
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
        const data = (await db.select('work_shifts', filters)) as any[];
        if (cancelled) return;
        setRows(
          (data ?? []).map((r: any) => ({
            id: r.id,
            number: String(r.number ?? ''),
            name: r.name ?? r.description ?? '—',
            config: r.config ?? {},
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

  const sorted = [...rows].sort((a, b) => {
    const na = parseInt(a.number, 10);
    const nb = parseInt(b.number, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  return (
    <ReportReadShell
      title="LISTAGEM DE HORÁRIOS"
      subtitle="Somente leitura — dados dos cadastros de horário da empresa."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
          <Printer className="w-4 h-4 mr-1.5 inline" /> Imprimir
        </Button>
      }
    >
      {loadingData ? (
        <LoadingState message="Carregando horários..." />
      ) : sorted.length === 0 ? (
        <p className="text-center text-slate-500 py-12">Nenhum horário cadastrado.</p>
      ) : (
        <div className="space-y-10">
          {sorted.map((shift, idx) => {
            const ws = shift.config?.weekly_schedule;
            const days: WeeklyScheduleDay[] =
              Array.isArray(ws) && ws.length === 7
                ? ws
                : DIA_SHORT.map((_, i) => ({
                    dayIndex: i,
                    dayType: 'normal' as const,
                    entrada1: '',
                    saida1: '',
                    entrada2: '',
                    saida2: '',
                    entrada3: '',
                    saida3: '',
                    toleranciaExtras: 5,
                    toleranciaFaltas: 5,
                    cargaHoraria: '00:00',
                  }));

            return (
              <article key={shift.id} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900/50 print:shadow-none print:border-slate-400">
                <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2 border-b border-slate-200 dark:border-slate-600">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    Número {shift.number || idx + 1}{' '}
                    <span className="font-semibold text-slate-600 dark:text-slate-300">Nome {shift.name}</span>
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[900px]">
                    <thead>
                      <tr className="bg-slate-700 text-white text-[10px] sm:text-xs">
                        <th className="text-left px-2 py-2 font-bold">DIA</th>
                        <th className="text-left px-2 py-2 font-bold">ENTRADA 1 / SAÍDA 1</th>
                        <th className="text-left px-2 py-2 font-bold">ENTRADA 2 / SAÍDA 2</th>
                        <th className="text-left px-2 py-2 font-bold">ENTRADA 3 / SAÍDA 3</th>
                        <th className="text-center px-1 py-2 font-bold">T +/-</th>
                        <th className="text-center px-1 py-2 font-bold">T EXTRA</th>
                        <th className="text-center px-1 py-2 font-bold">T FALTA</th>
                        <th className="text-center px-1 py-2 font-bold">ALM. L.</th>
                        <th className="text-center px-1 py-2 font-bold">COMP.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d, i) => {
                        const folga = d.dayType === 'folga';
                        const extra = d.toleranciaExtras ?? 5;
                        const falta = d.toleranciaFaltas ?? 5;
                        return (
                          <tr
                            key={i}
                            className="border-b border-slate-200 dark:border-slate-700 odd:bg-white even:bg-slate-50/80 dark:odd:bg-slate-900/30 dark:even:bg-slate-800/20"
                          >
                            <td className="px-2 py-1.5 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                              {DIA_SHORT[i]}
                            </td>
                            <td className="px-2 py-1.5 text-slate-800 dark:text-slate-100 whitespace-pre-line align-top">
                              {folga ? 'Folga' : blocoEntradaSaida(d.entrada1, d.saida1, false)}
                            </td>
                            <td className="px-2 py-1.5 text-slate-800 dark:text-slate-100 whitespace-pre-line align-top">
                              {folga ? '—' : blocoEntradaSaida(d.entrada2, d.saida2, false)}
                            </td>
                            <td className="px-2 py-1.5 text-slate-800 dark:text-slate-100 whitespace-pre-line align-top">
                              {folga ? '—' : blocoEntradaSaida(d.entrada3, d.saida3, false)}
                            </td>
                            <td className="px-1 py-1.5 text-center tabular-nums">—</td>
                            <td className="px-1 py-1.5 text-center tabular-nums">{folga ? '—' : extra}</td>
                            <td className="px-1 py-1.5 text-center tabular-nums">{folga ? '—' : falta}</td>
                            <td className="px-1 py-1.5 text-center">—</td>
                            <td className="px-1 py-1.5 text-center">{folga ? '—' : 'X'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </ReportReadShell>
  );
}
