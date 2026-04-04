import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import { Input, LoadingState } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { calculateMonthlyBalance, WorkSchedule } from '../utils/timeCalculations';
import { TimeRecord, LogType, PunchMethod } from '../../types';

interface TimeBalanceRow {
  id: string;
  month: string;
  total_hours: number;
  extra_hours: number;
  debit_hours: number;
  final_balance: number;
}

const TimeBalancePage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [supabaseBalance, setSupabaseBalance] = useState<TimeBalanceRow | null>(null);
  const [records, setRecords] = useState<TimeRecord[]>([]);
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [monthInput, setMonthInput] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [bankMovements, setBankMovements] = useState<
    { date: string; hours_added: number; hours_removed: number; balance: number; source?: string }[]
  >([]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      try {
        const [balanceResult, recRows, wsRows, usRows, bankRows] = await Promise.all([
          db
            .select(
              'time_balance',
              [
                { column: 'user_id', operator: 'eq', value: user.id },
                { column: 'month', operator: 'eq', value: monthInput },
              ],
              { column: 'month', ascending: false },
              1,
            )
            .then((rows) => rows ?? [])
            .catch(() => [] as any[]),
          db.select(
            'time_records',
            [{ column: 'user_id', operator: 'eq', value: user.id }],
            { column: 'created_at', ascending: false },
            500,
          ),
          db.select(
            'work_schedules',
            [{ column: 'company_id', operator: 'eq', value: user.companyId }],
          ),
          db.select(
            'user_schedules',
            [{ column: 'user_id', operator: 'eq', value: user.id }],
          ),
          db
            .select(
              'bank_hours',
              [{ column: 'employee_id', operator: 'eq', value: user.id }],
              { column: 'date', ascending: false },
              120,
            )
            .catch(() => [] as any[]),
        ]);

        const balanceRows = Array.isArray(balanceResult) ? balanceResult : [];
        if (balanceRows.length > 0) {
          const b = balanceRows[0];
          setSupabaseBalance({
            id: b.id,
            month: b.month,
            total_hours: b.total_hours ?? 0,
            extra_hours: b.extra_hours ?? 0,
            debit_hours: b.debit_hours ?? 0,
            final_balance: b.final_balance ?? 0,
          });
        } else {
          setSupabaseBalance(null);
        }

        const mappedBank = (bankRows as any[] | undefined)?.map((b) => ({
          date: (b.date || '').slice(0, 10),
          hours_added: Number(b.hours_added ?? 0),
          hours_removed: Number(b.hours_removed ?? 0),
          balance: Number(b.balance ?? 0),
          source: b.source,
        }));
        setBankMovements(mappedBank ?? []);

        const mappedRecords: TimeRecord[] =
          recRows?.map((r: any) => ({
            id: r.id,
            userId: r.user_id,
            companyId: r.company_id,
            type:
              r.type === 'entrada' || r.type === LogType.IN
                ? LogType.IN
                : r.type === 'saída' || r.type === 'saida' || r.type === LogType.OUT
                  ? LogType.OUT
                  : LogType.BREAK,
            method: (r.method as PunchMethod) || PunchMethod.MANUAL,
            photoUrl: r.photo_url ?? undefined,
            location: r.location ?? undefined,
            justification: r.justification ?? undefined,
            createdAt: new Date(r.created_at),
            ipAddress: r.ip_address ?? '',
            deviceId: r.device_id ?? '',
            fraudFlags: r.fraud_flags ?? [],
            deviceInfo: r.device_info ?? {
              browser: '',
              os: '',
              isMobile: false,
              userAgent: '',
            },
            adjustments: r.adjustments ?? [],
          })) ?? [];

        setRecords(mappedRecords);

        const scheduleList: WorkSchedule[] =
          wsRows?.map((w: any) => ({
            id: w.id,
            name: w.name,
            start_time: w.start_time,
            end_time: w.end_time,
            break_start: w.break_start,
            break_end: w.break_end,
            tolerance_minutes: w.tolerance_minutes,
          })) ?? [];
        setSchedules(scheduleList);

        // simples: pega 1a escala associada a user_schedules
        const userScheduleId = usRows && usRows.length > 0 ? usRows[0].schedule_id : null;
        if (userScheduleId) {
          const ws = scheduleList.find((s) => s.id === userScheduleId);
          if (ws) {
            // nothing, usaremos ws via schedulesByDate
          }
        }
      } catch (e) {
        console.error('Erro ao carregar saldo de horas:', e);
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user, monthInput]);

  const computedMonthly = useMemo(() => {
    if (!records.length || !schedules.length) return null;
    const [year, month] = monthInput.split('-').map(Number);

    const defaultSchedule = schedules[0];
    const byDate = (_date: Date) => defaultSchedule;

    return calculateMonthlyBalance(
      records,
      byDate,
      month - 1,
      year,
    );
  }, [records, schedules, monthInput]);

  if (loading) {
    return <LoadingState message="Carregando saldo de horas..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Banco de Horas"
        subtitle="Saldo a partir das movimentações registradas; o resumo mensal complementa quando a folha foi fechada."
        icon={<Scale className="w-5 h-5" />}
      />

      <div className="glass-card rounded-[2.25rem] p-6 space-y-4">
        <Input
          label="Mês de referência"
          type="month"
          value={monthInput}
          onChange={(e) => setMonthInput(e.target.value)}
        />
      </div>

      {isLoadingData ? (
        <LoadingState message="Carregando saldo..." />
      ) : (
        <>
          {bankMovements.length > 0 && (
            <div className="glass-card rounded-[2.25rem] p-6 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Movimentações do banco (crédito / débito)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Crédito: horas extras ou acertos positivos. Débito: faltas ou compensações. O saldo é cumulativo até a data.
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 text-left">
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400">Data</th>
                      <th className="px-3 py-2 font-semibold text-emerald-600 text-right">Crédito (h)</th>
                      <th className="px-3 py-2 font-semibold text-red-600 text-right">Débito (h)</th>
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400 text-right">Saldo (h)</th>
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400">Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankMovements.slice(0, 40).map((m, i) => (
                      <tr key={`${m.date}-${i}`} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2 tabular-nums">{m.date ? new Date(m.date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{m.hours_added > 0 ? `+${m.hours_added.toFixed(2)}` : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-600">{m.hours_removed > 0 ? `−${m.hours_removed.toFixed(2)}` : '—'}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {m.balance >= 0 ? '+' : ''}
                          {m.balance.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400 text-xs">{m.source || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {supabaseBalance && (
            <div className="glass-card rounded-[2.25rem] p-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Horas trabalhadas
                </p>
                <p className="text-xl font-extrabold text-slate-900 dark:text-white">
                  {supabaseBalance.total_hours.toFixed(1)}h
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Horas extras (crédito)
                </p>
                <p className="text-xl font-extrabold text-emerald-600">
                  {supabaseBalance.extra_hours.toFixed(1)}h
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Débito
                </p>
                <p className="text-xl font-extrabold text-red-600">
                  {supabaseBalance.debit_hours.toFixed(1)}h
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Saldo final
                </p>
                <p className="text-xl font-extrabold text-slate-900 dark:text-white">
                  {supabaseBalance.final_balance >= 0 ? '+' : ''}
                  {supabaseBalance.final_balance.toFixed(1)}h
                </p>
              </div>
            </div>
          )}

          {!supabaseBalance && bankMovements.length === 0 && (
            <div className="glass-card rounded-[2.25rem] p-6 text-sm text-slate-600 dark:text-slate-400">
              Não há fechamento de folha nem movimentações de banco para o mês selecionado. O saldo passa a aparecer após o processamento diário ou fechamento pelo RH.
            </div>
          )}

          {computedMonthly && (
            <DataTable<typeof computedMonthly.days[0]>
              columns={[
                {
                  key: 'date',
                  header: 'Data',
                },
                {
                  key: 'workedHours',
                  header: 'Trabalhado',
                  render: (row) => `${row.workedHours.toFixed(1)}h`,
                },
                {
                  key: 'expectedHours',
                  header: 'Previsto',
                  render: (row) => `${row.expectedHours.toFixed(1)}h`,
                },
                {
                  key: 'balanceHours',
                  header: 'Saldo',
                  render: (row) => `${row.balanceHours.toFixed(1)}h`,
                },
              ]}
              data={computedMonthly.days}
            />
          )}
        </>
      )}
    </div>
  );
};

export default TimeBalancePage;

