import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { CalendarDays, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

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
  schedule_id?: string;
};

type PontoRow = {
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
  const [records, setRecords] = useState<any[]>([]);
  const [diasMeta, setDiasMeta] = useState<Record<string, { id?: string; meta: DayMeta }>>({});
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterDept, setFilterDept] = useState('');
  const [filterCargo, setFilterCargo] = useState('');
  const [filterTipo, setFilterTipo] = useState<'all' | 'employee' | 'admin' | 'hr' | 'supervisor'>('all');
  const [filterHorarioId, setFilterHorarioId] = useState('');
  const [loadingData, setLoadingData] = useState(true);
  const [savingMeta, setSavingMeta] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [diasDirty, setDiasDirty] = useState<Record<string, DayMeta>>({});

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) {
      setLoadingData(false);
      return;
    }
    const load = async () => {
      setLoadingData(true);
      try {
        // Calcular data de 30 dias atrás
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateFilter = thirtyDaysAgo.toISOString().slice(0, 10);

        const [usersRows, recsRows, metasRows] = await Promise.all([
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('time_records', [
            { column: 'company_id', operator: 'eq', value: user.companyId },
            { column: 'created_at', operator: 'gte', value: dateFilter }
          ], { column: 'created_at', ascending: true }, 500) as Promise<any[]>,
          db.select('cartao_ponto_dia', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);
        setEmployees(
          (usersRows ?? []).map((u: any) => ({
            id: u.id,
            nome: u.nome || u.email || '',
            cargo: u.cargo || '',
            department_id: u.department_id,
            schedule_id: u.schedule_id,
          })),
        );
        setRecords(recsRows ?? []);
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
        console.error(e);
        setMessage({ type: 'error', text: 'Erro ao carregar dados de Ponto Diário.' });
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, [user?.companyId]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      if (filterDept && e.department_id !== filterDept) return false;
      if (filterCargo && (e.cargo || '').toLowerCase() !== filterCargo.toLowerCase()) return false;
      if (filterHorarioId && e.schedule_id !== filterHorarioId) return false;
      if (filterTipo !== 'all' && (user?.role === 'admin' || user?.role === 'hr')) {
        // role não está em employees; filtro de tipo pode ser implementado depois
      }
      return true;
    });
  }, [employees, filterDept, filterCargo, filterHorarioId, filterTipo, user?.role]);

  const getMetaForDay = (empId: string): DayMeta => {
    const key = `${empId}_${data}`;
    if (diasDirty[key]) return diasDirty[key];
    const stored = diasMeta[key];
    if (stored) return stored.meta;
    return { comp: false, ref: '', ajuste: '' };
  };

  const setMetaForDay = (empId: string, patch: Partial<DayMeta>) => {
    const key = `${empId}_${data}`;
    const prev = getMetaForDay(empId);
    const next = { ...prev, ...patch };
    setDiasDirty((m) => ({ ...m, [key]: next }));
  };

  const rows: PontoRow[] = useMemo(() => {
    if (!data) return [];
    const rows: PontoRow[] = [];
    const byUser = new Map<string, any[]>();
    records.forEach((r: any) => {
      const d = (r.created_at || '').slice(0, 10);
      if (d !== data) return;
      const arr = byUser.get(r.user_id) || [];
      arr.push(r);
      byUser.set(r.user_id, arr);
    });
    filteredEmployees.forEach((emp) => {
      const recs = (byUser.get(emp.id) || []).sort((a, b) =>
        (a.created_at || '').localeCompare(b.created_at || ''),
      );
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
      rows.push({
        employee: emp,
        entradas,
        saidas,
        meta: getMetaForDay(emp.id),
        workedHours: workedLabel,
      });
    });
    return rows;
  }, [filteredEmployees, records, data, diasMeta, diasDirty]);

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
        const [userId] = key.split('_');
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
            data,
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
    const d = new Date(data || new Date().toISOString().slice(0, 10));
    d.setDate(d.getDate() + delta);
    setData(d.toISOString().slice(0, 10));
  };

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
              Data
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
                onChange={(e) => setData(e.target.value)}
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
              Departamento
            </label>
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-full sm:min-w-[160px]"
            >
              <option value="">Todos</option>
              {[...new Set(employees.map((e) => e.department_id).filter(Boolean))].map((id) => (
                <option key={id} value={id as string}>
                  {id}
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
              {[...new Set(employees.map((e) => e.schedule_id).filter(Boolean))].map((id) => (
                <option key={id} value={id as string}>
                  {id}
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
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Nenhum funcionário encontrado para {formatDateBr(data)} com os filtros atuais.
            </div>
          ) : (
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
                {rows.map((row) => {
                  const meta = row.meta;
                  const key = `${row.employee.id}_${data}`;
                  const isDirty = diasDirty[key] != null;
                  return (
                    <tr
                      key={row.employee.id}
                      className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                    >
                      <td className="px-3 py-1.5 text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {row.employee.nome}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.entradas[0] ? timeStr(row.entradas[0]) : '—'}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.saidas[0] ? timeStr(row.saidas[0]) : '—'}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.entradas[1] ? timeStr(row.entradas[1]) : '—'}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.saidas[1] ? timeStr(row.saidas[1]) : '—'}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.entradas[2] ? timeStr(row.entradas[2]) : '—'}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {row.saidas[2] ? timeStr(row.saidas[2]) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={meta.comp}
                          disabled={readOnly}
                          onChange={(e) =>
                            !readOnly && setMetaForDay(row.employee.id, { comp: e.target.checked })
                          }
                          className="rounded border-slate-300"
                          title="Compensado"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={meta.ref}
                          readOnly={readOnly}
                          onChange={(e) =>
                            !readOnly && setMetaForDay(row.employee.id, { ref: e.target.value })
                          }
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
                          onChange={(e) =>
                            !readOnly && setMetaForDay(row.employee.id, { ajuste: e.target.value })
                          }
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
                      <td className="px-3 py-1.5 tabular-nums text-slate-700 dark:text-slate-300">
                        {row.workedHours}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </RoleGuard>
  );
};

export default AdminPontoDiario;

