import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { CalendarDays, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { listTimeRecords } from '../../../services/timeRecords.service';
import { buscarColaboradores, buscarDepartamentos } from '../../../services/api';
import { fetchEmployees } from '../../services/employeesApi.service';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';
import { enumerateLocalCalendarDays } from '../../utils/localDateTimeToIso';
import { queryCache, TTL } from '../../services/queryCache';

const MAX_PONTO_DIARIO_RANGE_DAYS = 31;

type DayMeta = {
  comp: boolean;
  ref: string;
  ajuste: string;
};

type EmployeeRow = {
  id: string;
  nome: string;
  cargo?: string;
  department_id?: string;
  shift_id?: string;
  /** IDs em time_records (colaborador + usuário vinculado, como no Espelho). */
  record_user_ids: string[];
};

type FilterOption = { id: string; name: string };

function formatWorkShiftLabel(s: {
  number?: string;
  description?: string;
  name?: string;
  start_time?: string;
  end_time?: string;
}): string {
  const num = (s.number && String(s.number).trim()) || '';
  const title = String(s.description || s.name || '').trim() || 'Horário';
  const st = s.start_time != null ? String(s.start_time).slice(0, 5) : '';
  const en = s.end_time != null ? String(s.end_time).slice(0, 5) : '';
  const range = st && en ? `${st}–${en}` : '';
  return [num ? `#${num}` : '', title, range].filter(Boolean).join(' · ');
}

type PontoRow = {
  dayYmd: string;
  employee: EmployeeRow;
  entradas: (string | null)[];
  saidas: (string | null)[];
  meta: DayMeta;
  workedHours: string;
};

function timeStr(d: string): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return d.slice(11, 16) || '—';
  }
}

function formatDateBr(d: string) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

const AdminPontoDiario: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const location = useLocation();
  const readOnly = location.pathname === '/admin/ponto-diario-leitura';

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [departments, setDepartments] = useState<FilterOption[]>([]);
  const [workShifts, setWorkShifts] = useState<FilterOption[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [diasMeta, setDiasMeta] = useState<Record<string, { id?: string; meta: DayMeta }>>({});
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterDept, setFilterDept] = useState('');
  const [filterCargo, setFilterCargo] = useState('');
  const [filterTipo, setFilterTipo] = useState<'all' | 'employee' | 'admin' | 'hr' | 'supervisor'>('all');
  const [filterHorarioId, setFilterHorarioId] = useState('');
  const [loadingData, setLoadingData] = useState(true);
  const [savingMeta, setSavingMeta] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [diasDirty, setDiasDirty] = useState<Record<string, DayMeta>>({});

  const periodValid = Boolean(data && dataFim && data <= dataFim);

  const daysInRange = useMemo(() => {
    if (!periodValid) return [];
    const days = enumerateLocalCalendarDays(data, dataFim);
    return days.length <= MAX_PONTO_DIARIO_RANGE_DAYS ? days : [];
  }, [data, dataFim, periodValid]);

  const rangeTooWide = useMemo(() => {
    if (!periodValid) return false;
    return enumerateLocalCalendarDays(data, dataFim).length > MAX_PONTO_DIARIO_RANGE_DAYS;
  }, [data, dataFim, periodValid]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) {
      setLoadingData(false);
      return;
    }
    const loadCatalog = async () => {
      setLoadingData(true);
      try {
        const cid = user.companyId;
        const [colaboradores, departmentsRows, shiftRows] = await Promise.all([
          buscarColaboradores(cid),
          buscarDepartamentos(cid),
          queryCache.getOrFetch(
            `work_shifts:list:${cid}`,
            () =>
              db.select('work_shifts', [{ column: 'company_id', operator: 'eq', value: cid }], {
                columns: 'id,number,name,description,start_time,end_time,ativo,company_id',
                limit: 500,
                orderBy: { column: 'name', ascending: true },
              }) as Promise<any[]>,
            TTL.STATIC,
          ),
        ]);
        // Hit de cache de buscarColaboradores → fetchEmployees (sem 2º HTTP)
        const apiEmployees = await fetchEmployees(cid);
        const cargoById = new Map(apiEmployees.map((e) => [e.id, e.cargo ?? '']));
        const shiftById = new Map(
          apiEmployees.map((e) => [e.id, e.shift_id ?? e.work_shift_id ?? '']),
        );
        setEmployees(
          colaboradores.map((e) => ({
            id: e.id,
            nome: e.nome,
            cargo: cargoById.get(e.id) ?? '',
            department_id: e.department_id ?? undefined,
            shift_id: shiftById.get(e.id) || undefined,
            record_user_ids: e.record_user_ids?.length ? e.record_user_ids : [e.id],
          })),
        );
        setDepartments(
          (departmentsRows ?? [])
            .map((d) => ({ id: d.id, name: d.name || 'Departamento' }))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        );
        setWorkShifts(
          (shiftRows ?? [])
            .filter((s: any) => s.ativo !== false)
            .map((s: any) => ({
              id: String(s.id),
              name: formatWorkShiftLabel(s),
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        );
      } catch (e) {
        observabilityConsole.error(e);
        setMessage({ type: 'error', text: 'Erro ao carregar colaboradores do Ponto Diário.' });
      } finally {
        setLoadingData(false);
      }
    };
    void loadCatalog();
  }, [user?.companyId]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured() || !periodValid) {
      setDiasMeta({});
      setDiasDirty({});
      return;
    }
    let cancelled = false;
    const loadMetas = async () => {
      try {
        const metasRows = (await db.select('cartao_ponto_dia', [
          { column: 'company_id', operator: 'eq', value: user.companyId },
          { column: 'data', operator: 'gte', value: data },
          { column: 'data', operator: 'lte', value: dataFim },
        ])) as any[];
        if (cancelled) return;
        const metaMap: Record<string, { id?: string; meta: DayMeta }> = {};
        (metasRows ?? []).forEach((row: any) => {
          const d = row.data?.slice?.(0, 10) ?? row.data;
          if (!d) return;
          metaMap[`${row.user_id}_${d}`] = {
            id: row.id,
            meta: {
              comp: !!row.comp,
              ref: row.ref ?? '',
              ajuste: row.ajuste != null ? String(row.ajuste) : '',
            },
          };
        });
        setDiasMeta(metaMap);
        setDiasDirty({});
      } catch (e) {
        if (!cancelled) observabilityConsole.error(e);
      }
    };
    void loadMetas();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, data, dataFim, periodValid]);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured() || !periodValid) {
      return;
    }
    const loadRecords = async () => {
      setLoadingData(true);
      try {
        const recsRows = await listTimeRecords(
          [
            { column: 'company_id', operator: 'eq', value: user.companyId },
            { column: 'created_at', operator: 'gte', value: data },
            { column: 'created_at', operator: 'lte', value: `${dataFim}T23:59:59.999` },
          ],
          { column: 'created_at', ascending: true },
          2000,
        );
        setRecords(recsRows ?? []);
      } catch (e) {
        observabilityConsole.error(e);
        setMessage({ type: 'error', text: 'Erro ao carregar batidas do período.' });
      } finally {
        setLoadingData(false);
      }
    };
    void loadRecords();
  }, [user?.companyId, data, dataFim, periodValid]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      if (filterDept && e.department_id !== filterDept) return false;
      if (filterCargo && (e.cargo || '').toLowerCase() !== filterCargo.toLowerCase()) return false;
      if (filterHorarioId && e.shift_id !== filterHorarioId) return false;
      if (filterTipo !== 'all' && (user?.role === 'admin' || user?.role === 'hr')) {
        // role não está em employees; filtro de tipo pode ser implementado depois
      }
      return true;
    });
  }, [employees, filterDept, filterCargo, filterHorarioId, filterTipo, user?.role]);

  const getMetaForDay = (empId: string, dayYmd: string): DayMeta => {
    const key = `${empId}_${dayYmd}`;
    if (diasDirty[key]) return diasDirty[key];
    const stored = diasMeta[key];
    if (stored) return stored.meta;
    return { comp: false, ref: '', ajuste: '' };
  };

  const setMetaForDay = (empId: string, dayYmd: string, patch: Partial<DayMeta>) => {
    const key = `${empId}_${dayYmd}`;
    const prev = getMetaForDay(empId, dayYmd);
    const next = { ...prev, ...patch };
    setDiasDirty((m) => ({ ...m, [key]: next }));
  };

  const buildRowsForDay = (dayYmd: string): PontoRow[] => {
    const byUser = new Map<string, any[]>();
    records.forEach((r: any) => {
      const d = (r.created_at || '').slice(0, 10);
      if (d !== dayYmd) return;
      const arr = byUser.get(r.user_id) || [];
      arr.push(r);
      byUser.set(r.user_id, arr);
    });
    return filteredEmployees.map((emp) => {
      const matchIds = emp.record_user_ids?.length ? emp.record_user_ids : [emp.id];
      const recs = matchIds
        .flatMap((uid) => byUser.get(uid) || [])
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
      const entradas: (string | null)[] = [null, null, null];
      const saidas: (string | null)[] = [null, null, null];
      const entradasRecs = recs.filter((r: any) => r.type === 'entrada');
      const saidasRecs = recs.filter((r: any) => r.type === 'saída');
      for (let i = 0; i < 3; i++) {
        entradas[i] = entradasRecs[i]?.created_at ?? null;
        saidas[i] = saidasRecs[i]?.created_at ?? null;
      }
      let workedLabel = '—';
      if (entradas[0] && saidas[0]) {
        const a = new Date(entradas[0]);
        const b = new Date(saidas[saidas.length - 1] || saidas[0]);
        const mins = Math.max(0, (b.getTime() - a.getTime()) / 60000);
        const h = Math.floor(mins / 60);
        const m = Math.round(mins % 60);
        workedLabel = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      }
      return {
        dayYmd,
        employee: emp,
        entradas,
        saidas,
        meta: getMetaForDay(emp.id, dayYmd),
        workedHours: workedLabel,
      };
    });
  };

  const handleSaveMeta = async () => {
    if (readOnly || !user?.companyId || !isSupabaseConfigured()) return;
    const keys = Object.keys(diasDirty);
    if (!keys.length) {
      setMessage({ type: 'error', text: 'Nenhuma alteração para salvar.' });
      return;
    }
    setSavingMeta(true);
    setMessage(null);
    try {
      for (const key of keys) {
        const underscoreIdx = key.lastIndexOf('_');
        const userId = underscoreIdx > 0 ? key.slice(0, underscoreIdx) : key.split('_')[0];
        const dayYmd = underscoreIdx > 0 ? key.slice(underscoreIdx + 1) : data;
        const meta = diasDirty[key];
        const existing = diasMeta[key];
        const payload = {
          comp: meta.comp,
          ref: meta.ref || null,
          ajuste: meta.ajuste ? Number(meta.ajuste.replace(',', '.')) : null,
        };
        if (existing?.id) {
          await db.update('cartao_ponto_dia', existing.id, payload);
        } else {
          await db.insert('cartao_ponto_dia', {
            id: crypto.randomUUID(),
            user_id: userId,
            company_id: user.companyId,
            data: dayYmd,
            ...payload,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }
      setMessage({ type: 'success', text: 'Ajustes do dia salvos.' });
      setDiasDirty({});
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao salvar ajustes.' });
    } finally {
      setSavingMeta(false);
    }
  };

  const changeDay = (delta: number) => {
    const singleDay = data === dataFim;
    const start = new Date(`${data || new Date().toISOString().slice(0, 10)}T12:00:00`);
    start.setDate(start.getDate() + delta);
    const nextStart = start.toISOString().slice(0, 10);
    setData(nextStart);
    if (singleDay) {
      setDataFim(nextStart);
    } else if (nextStart > dataFim) {
      setDataFim(nextStart);
    }
  };

  const renderDayTable = (dayYmd: string, dayRows: PontoRow[]) => (
    <div key={dayYmd} className={daysInRange.length > 1 ? 'border-b border-slate-200 dark:border-slate-700 last:border-b-0' : ''}>
      {daysInRange.length > 1 && (
        <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800/80 text-sm font-semibold text-slate-700 dark:text-slate-200 sticky top-0">
          {formatDateBr(dayYmd)}
        </div>
      )}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Funcionário</th>
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Ent. 1</th>
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Saí. 1</th>
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Ent. 2</th>
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Saí. 2</th>
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Ent. 3</th>
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Saí. 3</th>
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Comp</th>
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Ref</th>
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Ajuste</th>
            <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Normais (aprox.)</th>
          </tr>
        </thead>
        <tbody>
          {dayRows.map((row) => {
            const meta = row.meta;
            const key = `${row.employee.id}_${dayYmd}`;
            const isDirty = diasDirty[key] != null;
            return (
              <tr
                key={`${dayYmd}_${row.employee.id}`}
                className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
              >
                <td className="px-3 py-1.5 text-slate-900 dark:text-slate-100 whitespace-nowrap">
                  {row.employee.nome}
                </td>
                <td className="px-3 py-1.5 tabular-nums">{row.entradas[0] ? timeStr(row.entradas[0]) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{row.saidas[0] ? timeStr(row.saidas[0]) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{row.entradas[1] ? timeStr(row.entradas[1]) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{row.saidas[1] ? timeStr(row.saidas[1]) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{row.entradas[2] ? timeStr(row.entradas[2]) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{row.saidas[2] ? timeStr(row.saidas[2]) : '—'}</td>
                <td className="px-3 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={meta.comp}
                    disabled={readOnly}
                    onChange={(e) => !readOnly && setMetaForDay(row.employee.id, dayYmd, { comp: e.target.checked })}
                    className="rounded border-slate-300"
                    title="Compensado"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="text"
                    value={meta.ref}
                    readOnly={readOnly}
                    onChange={(e) => !readOnly && setMetaForDay(row.employee.id, dayYmd, { ref: e.target.value })}
                    className={`w-20 px-2 py-0.5 rounded border text-xs ${
                      readOnly ? 'bg-slate-50 dark:bg-slate-800/50 cursor-default' : ''
                    } ${
                      !readOnly && isDirty
                        ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                    placeholder="Ref"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="text"
                    value={meta.ajuste}
                    readOnly={readOnly}
                    onChange={(e) => !readOnly && setMetaForDay(row.employee.id, dayYmd, { ajuste: e.target.value })}
                    className={`w-20 px-2 py-0.5 rounded border text-xs tabular-nums ${
                      readOnly ? 'bg-slate-50 dark:bg-slate-800/50 cursor-default' : ''
                    } ${
                      !readOnly && isDirty
                        ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                    placeholder="+/-"
                  />
                </td>
                <td className="px-3 py-1.5 tabular-nums text-slate-700 dark:text-slate-300">{row.workedHours}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-4">
        <PageHeader
          title={readOnly ? 'Ponto Diário (Somente Leitura)' : 'Ponto Diário'}
          subtitle={
            readOnly
              ? 'Visualização dia a dia das batidas e cálculos, com Incluir/Alterar/Excluir e Salvar desativados.'
              : 'Visualize e, se necessário, ajuste Compensado, Reserva de Refeição e Ajuste por dia.'
          }
          icon={<CalendarDays size={24} />}
        />

        {message && (
          <div
            className={`p-4 rounded-xl text-sm ${
              message.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Filtros e controles */}
        <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div className="w-full sm:w-auto">
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
              Data inicial
            </label>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => changeDay(-1)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="date"
                value={data}
                max={dataFim}
                onChange={(e) => {
                  const next = e.target.value;
                  setData(next);
                  if (next > dataFim) setDataFim(next);
                }}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white flex-1 sm:flex-none"
              />
              <button
                type="button"
                onClick={() => changeDay(1)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="w-full sm:w-auto">
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
              Data final
            </label>
            <input
              type="date"
              value={dataFim}
              min={data}
              onChange={(e) => {
                const next = e.target.value;
                setDataFim(next);
                if (next < data) setData(next);
              }}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-full sm:min-w-[160px]"
            />
          </div>
          <div className="w-full sm:w-auto">
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
              Departamento
            </label>
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-full sm:min-w-[160px]"
            >
              <option value="">Todos</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-auto">
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
              Função
            </label>
            <input
              type="text"
              value={filterCargo}
              onChange={(e) => setFilterCargo(e.target.value)}
              placeholder="Filtrar por cargo"
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-full sm:min-w-[160px]"
            />
          </div>
          <div className="w-full sm:w-auto">
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
              Horário
            </label>
            <select
              value={filterHorarioId}
              onChange={(e) => setFilterHorarioId(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-full sm:min-w-[140px]"
            >
              <option value="">Todos</option>
              {workShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto text-xs text-slate-500 dark:text-slate-400 mt-2 sm:mt-0">
            <Filter className="w-3 h-3 flex-shrink-0" /> Filtros especiais básicos como &quot;Dia em branco&quot; e
            &quot;Com movimento&quot; poderão ser adicionados aqui em versões futuras.
          </div>
        </div>

        {/* Aviso de salvar (somente acesso completo) */}
        {!readOnly && Object.keys(diasDirty).length > 0 && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
            <span className="flex-1">Existem ajustes (Comp, Ref, Ajuste) pendentes de salvar para este dia.</span>
            <button
              type="button"
              onClick={handleSaveMeta}
              disabled={savingMeta}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {savingMeta ? 'Salvando...' : 'Salvar ajustes'}
            </button>
          </div>
        )}

        {/* Grid Ponto Diário */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-x-auto">
          {loadingData ? (
            <div className="p-12 text-center text-slate-500">Carregando...</div>
          ) : !periodValid ? (
            <div className="p-12 text-center text-slate-500">Informe um período válido (data inicial ≤ data final).</div>
          ) : rangeTooWide ? (
            <div className="p-12 text-center text-slate-500">
              Período máximo de {MAX_PONTO_DIARIO_RANGE_DAYS} dias. Reduza o intervalo entre as datas.
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Nenhum colaborador encontrado com os filtros atuais.
            </div>
          ) : (
            daysInRange.map((dayYmd) => renderDayTable(dayYmd, buildRowsForDay(dayYmd)))
          )}
        </div>
      </div>
    </RoleGuard>
  );
};

export default AdminPontoDiario;

