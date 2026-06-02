import { observabilityConsole } from '../shared/logger/observabilityConsole';
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Scale, Info } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import { Input, LoadingState } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { formatDateForTablePtBr } from '../utils/timeCalculations';
import {
  expectedMinutesFromSchedule,
  getEmployeeTimesheetScheduleContext,
  type DayExpectedWindow,
  type WorkScheduleInfo,
} from '../services/timeProcessingService';
import { extractLocalCalendarDateFromIso } from '../utils/timesheetMirror';
import { recordPunchInstantIso, recordPunchInstantMs } from '../utils/punchOrigin';
import { calcularHorasHojeMs } from '../utils/workedHoursToday';
import { fetchTimeRecordsForMirrorWindow } from '../../services/api';

interface TimeBalanceRow {
  id: string;
  month: string;
  total_hours: number;
  extra_hours: number;
  debit_hours: number;
  final_balance: number;
}

/** Linhas do motor diário (`bank_hours_ledger`); RLS permite ao colaborador SELECT próprio. */
type LedgerMonthRow = {
  id: string;
  date: string;
  type: 'CREDIT' | 'DEBIT';
  minutes: number;
  source: string;
  used_minutes: number;
  created_at?: string;
};

function ledgerTypeLabelPt(t: string): string {
  return t === 'DEBIT' ? 'Débito' : t === 'CREDIT' ? 'Crédito' : t;
}

function ledgerSourceLabelPt(s: string): string {
  if (s === 'EXTRA') return 'Horas extras';
  if (s === 'ABSENCE') return 'Falta / negativo';
  if (s === 'MANUAL') return 'Manual';
  return s || '—';
}

function minutesToHoursLabel(m: number): string {
  const v = Math.abs(m) / 60;
  return `${v.toFixed(2)}h`;
}

function logTimeBalanceDebug(label: string, payload: unknown): void {
  console.log(label, payload);
}

type DailyRefRow = {
  id: string;
  dateYmd: string;
  dateLabel: string;
  workedHours: number;
  expectedHours: number;
  balanceHours: number;
  isWorkday: boolean;
};

function computeLedgerAvailableBalanceMinutes(rows: LedgerMonthRow[]): number {
  return rows.reduce((acc, row) => {
    if (row.type === 'CREDIT') return acc + Math.max(0, row.minutes - row.used_minutes);
    if (row.type === 'DEBIT') return acc - Math.max(0, row.minutes);
    return acc;
  }, 0);
}

function padHhMm(t: string | undefined | null): string {
  const s = String(t ?? '').trim();
  return s.length >= 5 ? s.slice(0, 5) : '00:00';
}

function dayWindowToScheduleInfo(win: DayExpectedWindow): WorkScheduleInfo {
  const entrada = padHhMm(win.entrada);
  const saida = padHhMm(win.saida);
  const breakOut = win.saida_intervalo ? padHhMm(win.saida_intervalo) : entrada;
  const breakIn = win.volta_intervalo ? padHhMm(win.volta_intervalo) : entrada;
  return {
    start_time: entrada,
    end_time: saida,
    break_start: breakOut,
    break_end: breakIn,
    tolerance_minutes: win.toleranceMin ?? 0,
    daily_hours: 8,
    work_days: [],
  };
}

const TimeBalancePage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [supabaseBalance, setSupabaseBalance] = useState<TimeBalanceRow | null>(null);
  const [dailyReference, setDailyReference] = useState<DailyRefRow[]>([]);
  const [monthInput, setMonthInput] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [ledgerMonthRows, setLedgerMonthRows] = useState<LedgerMonthRow[]>([]);

  const monthBounds = useMemo(() => {
    const [y, m] = monthInput.split('-').map(Number);
    if (!y || !m) return { startYmd: '', endYmd: '', year: 0, month: 0, lastDay: 0 };
    const lastDay = new Date(y, m, 0).getDate();
    const startYmd = `${y}-${String(m).padStart(2, '0')}-01`;
    const endYmd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { startYmd, endYmd, year: y, month: m, lastDay };
  }, [monthInput]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured()) return;

    const load = async () => {
      setIsLoadingData(true);
      try {
        const { startYmd, endYmd, year, month, lastDay } = monthBounds;
        if (!startYmd) {
          setDailyReference([]);
          setLedgerMonthRows([]);
          setSupabaseBalance(null);
          return;
        }

        const companyId = String(user.companyId ?? '').trim();
        logTimeBalanceDebug('USER', user);
        logTimeBalanceDebug('EMPLOYEE', {
          id: user.id,
          employeeId: user.id,
          companyId,
          tenantId: user.tenantId,
          role: user.role,
        });
        const ledgerFilters = [
          { column: 'employee_id', operator: 'eq' as const, value: user.id },
          { column: 'date', operator: 'gte' as const, value: startYmd },
          { column: 'date', operator: 'lte' as const, value: endYmd },
          ...(companyId ? [{ column: 'company_id' as const, operator: 'eq' as const, value: companyId }] : []),
        ];

        const [recRows, ledgerRows] = await Promise.all([
          fetchTimeRecordsForMirrorWindow(
            [
              ...(companyId ? [{ column: 'company_id' as const, operator: 'eq' as const, value: companyId }] : []),
              { column: 'user_id', operator: 'eq' as const, value: user.id },
            ],
            startYmd,
            endYmd,
            true,
            1500,
          ).catch(() => [] as any[]),
          db
            .select('bank_hours_ledger', ledgerFilters, { column: 'created_at', ascending: false }, 400)
            .catch(() => [] as any[]),
        ]);
        logTimeBalanceDebug('API RESPONSE', {
          endpoint: '/api/data/time_records',
          filters: [
            ...(companyId ? [{ column: 'company_id', operator: 'eq', value: companyId }] : []),
            { column: 'user_id', operator: 'eq', value: user.id },
          ],
          periodStart: startYmd,
          periodEnd: endYmd,
          count: Array.isArray(recRows) ? recRows.length : 0,
          sample: Array.isArray(recRows) ? recRows.slice(0, 5) : [],
        });
        logTimeBalanceDebug('TIME RECORDS', recRows);

        const mappedLedger: LedgerMonthRow[] = (Array.isArray(ledgerRows) ? ledgerRows : [])
          .map((r: any) => ({
            id: String(r.id ?? ''),
            date: String(r.date ?? '').slice(0, 10),
            type: r.type === 'DEBIT' ? 'DEBIT' : 'CREDIT',
            minutes: Math.max(0, Number(r.minutes ?? 0)),
            source: String(r.source ?? ''),
            used_minutes: Math.max(0, Number(r.used_minutes ?? 0)),
            created_at: r.created_at ? String(r.created_at) : undefined,
          }))
          .filter((r) => r.id && r.date.startsWith(monthInput));
        setLedgerMonthRows(mappedLedger);
        const creditMinutes = mappedLedger
          .filter((r) => r.type === 'CREDIT')
          .reduce((acc, r) => acc + Math.max(0, r.minutes), 0);
        const debitMinutes = mappedLedger
          .filter((r) => r.type === 'DEBIT')
          .reduce((acc, r) => acc + Math.max(0, r.minutes), 0);
        const finalBalanceHours = computeLedgerAvailableBalanceMinutes(mappedLedger) / 60;
        setSupabaseBalance({
          id: `ledger-${user.id}-${monthInput}`,
          month: monthInput,
          total_hours: 0,
          extra_hours: Math.round((creditMinutes / 60) * 100) / 100,
          debit_hours: Math.round((debitMinutes / 60) * 100) / 100,
          final_balance: Math.round(finalBalanceHours * 100) / 100,
        });

        const list = Array.isArray(recRows) ? recRows : [];

        const byYmd = new Map<string, any[]>();
        for (const r of list) {
          const ymd = extractLocalCalendarDateFromIso(recordPunchInstantIso(r));
          if (ymd < startYmd || ymd > endYmd) continue;
          if (!byYmd.has(ymd)) byYmd.set(ymd, []);
          byYmd.get(ymd)!.push(r);
        }

        const emptyWindows: Record<number, DayExpectedWindow | null> = {
          0: null,
          1: null,
          2: null,
          3: null,
          4: null,
          5: null,
          6: null,
        };
        let ctx: { workDays: number[]; windowByJsDow: Record<number, DayExpectedWindow | null> };
        try {
          ctx = await getEmployeeTimesheetScheduleContext(user.id, user.companyId);
        } catch {
          ctx = { workDays: [], windowByJsDow: { ...emptyWindows } };
        }
        const rows: DailyRefRow[] = [];
        for (let d = 1; d <= lastDay; d++) {
          const ymd = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const dt = new Date(year, month - 1, d);
          const dow = dt.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
          const win = ctx.windowByJsDow[dow];
          const isWorkday = win != null;
          const expectedMin = isWorkday ? expectedMinutesFromSchedule(dayWindowToScheduleInfo(win)) : 0;
          const expectedH = expectedMin / 60;
          const dayList = byYmd.get(ymd) ?? [];
          const sorted = [...dayList].sort((a, b) => recordPunchInstantMs(a) - recordPunchInstantMs(b));
          const workedMs = calcularHorasHojeMs(sorted);
          const workedH = workedMs / (1000 * 60 * 60);
          rows.push({
            id: ymd,
            dateYmd: ymd,
            dateLabel: formatDateForTablePtBr(ymd),
            workedHours: Math.round(workedH * 100) / 100,
            expectedHours: Math.round(expectedH * 100) / 100,
            balanceHours: Math.round((workedH - expectedH) * 100) / 100,
            isWorkday,
          });
        }
        setDailyReference(rows);
      } catch (e) {
        observabilityConsole.error('Erro ao carregar saldo de horas:', e);
      } finally {
        setIsLoadingData(false);
      }
    };

    void load();
  }, [user, monthInput, monthBounds]);

  const hasOfficialClosing = !!supabaseBalance;
  const hasBankMovements = ledgerMonthRows.length > 0;
  const showReferenceTable = dailyReference.length > 0;

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
        subtitle="Movimentações oficiais do banco, fechamento mensal (quando existir) e referência diária com base nas suas batidas e na escala cadastrada."
        icon={<Scale className="w-5 h-5" />}
      />

      <div className="glass-card rounded-[2.25rem] p-6 space-y-4">
        <Input label="Mês de referência" type="month" value={monthInput} onChange={(e) => setMonthInput(e.target.value)} />
      </div>

      {isLoadingData ? (
        <LoadingState message="Carregando saldo..." />
      ) : (
        <>
          {!hasOfficialClosing && !hasBankMovements && (
            <div className="glass-card rounded-[2.25rem] p-5 flex gap-3 border border-amber-200/80 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20">
              <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-950 dark:text-amber-100 space-y-1">
                <p className="font-semibold">Sem fechamento de folha nem lançamentos no banco (neste mês)</p>
                <p className="text-amber-900/90 dark:text-amber-200/90">
                  O resumo oficial e as linhas de crédito/débito aparecem após o processamento diário ou quando o RH fechar a folha. Abaixo, a tabela é apenas uma{' '}
                  <strong>referência</strong> calculada a partir das batidas e da sua escala (inclui dias de folga com 0h previstas).
                </p>
              </div>
            </div>
          )}

          {ledgerMonthRows.length > 0 && (
            <div className="glass-card rounded-[2.25rem] p-6 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Movimentações do banco (motor atual)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Lançamentos gerados pelo processamento diário em <code className="text-[10px]">bank_hours_ledger</code>. Créditos podem ser consumidos depois (FIFO); a coluna “utilizado” mostra quanto já foi abatido do pacote.
              </p>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 text-left">
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400">Data</th>
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400">Tipo</th>
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400 text-right">Valor</th>
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400 text-right">Utilizado</th>
                      <th className="px-3 py-2 font-semibold text-slate-500 dark:text-slate-400">Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerMonthRows.slice(0, 80).map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2 tabular-nums">{row.date ? formatDateForTablePtBr(row.date) : '—'}</td>
                        <td
                          className={`px-3 py-2 font-medium ${row.type === 'DEBIT' ? 'text-red-600' : 'text-emerald-600'}`}
                        >
                          {ledgerTypeLabelPt(row.type)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {row.type === 'DEBIT' ? '−' : '+'}
                          {minutesToHoursLabel(row.minutes)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {row.type === 'CREDIT' && row.used_minutes > 0 ? minutesToHoursLabel(row.used_minutes) : '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400 text-xs">{ledgerSourceLabelPt(row.source)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {hasOfficialClosing && (
            <div className="glass-card rounded-[2.25rem] p-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas trabalhadas</p>
                <p className="text-xl font-extrabold text-slate-900 dark:text-white">{supabaseBalance!.total_hours.toFixed(1)}h</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horas extras (crédito)</p>
                <p className="text-xl font-extrabold text-emerald-600">{supabaseBalance!.extra_hours.toFixed(1)}h</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Débito</p>
                <p className="text-xl font-extrabold text-red-600">{supabaseBalance!.debit_hours.toFixed(1)}h</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Saldo final</p>
                <p className="text-xl font-extrabold text-slate-900 dark:text-white">
                  {supabaseBalance!.final_balance >= 0 ? '+' : ''}
                  {supabaseBalance!.final_balance.toFixed(1)}h
                </p>
              </div>
            </div>
          )}

          {showReferenceTable && (
            <div className="glass-card rounded-[2.25rem] p-6 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Referência dia a dia</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                    Trabalhado: soma das janelas entre batidas (mesma lógica do espelho). Previsto: jornada do seu cadastro (escala + turno) por dia da semana; em folga aparece 0h. Não substitui o saldo oficial do banco.
                  </p>
                </div>
              </div>
              <DataTable<DailyRefRow>
                columns={[
                  { key: 'dateLabel', header: 'Data' },
                  {
                    key: 'workedHours',
                    header: 'Trabalhado',
                    render: (row) => `${row.workedHours.toFixed(1)}h`,
                  },
                  {
                    key: 'expectedHours',
                    header: 'Previsto',
                    render: (row) => (row.isWorkday ? `${row.expectedHours.toFixed(1)}h` : '—'),
                  },
                  {
                    key: 'balanceHours',
                    header: 'Saldo (dia)',
                    render: (row) => (row.isWorkday ? `${row.balanceHours >= 0 ? '+' : ''}${row.balanceHours.toFixed(1)}h` : '—'),
                  },
                  {
                    key: 'isWorkday',
                    header: 'Tipo',
                    render: (row) => (row.isWorkday ? 'Jornada' : 'Folga'),
                  },
                ]}
                data={dailyReference}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TimeBalancePage;
