import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CalendarDays, Download, Filter } from 'lucide-react';
import RoleGuard from '../components/auth/RoleGuard';
import PageHeader from '../components/PageHeader';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured, supabase } from '../services/supabaseClient';
import { LoadingState } from '../../components/UI';

type AusenciaRow = {
  user_id: string;
  nome: string;
  numero_folha: string | null;
  empresa: string | null;
  departamento: string | null;
  data: string; // ISO date
  minutos_trabalhados: number | null;
  minutos_extra: number | null;
  minutos_falta: number | null;
  minutos_almoco: number | null;
  minutos_interjornada: number | null;
};

const AdminAusencias: React.FC = () => {
  const { user, loading } = useCurrentUser();

  const [dataIni, setDataIni] = useState(() =>
    new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().slice(0, 10),
  );
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().slice(0, 10));

  const [departmentId, setDepartmentId] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>('');

  const [cargaDiaria, setCargaDiaria] = useState<number>(480);
  const [extraMin, setExtraMin] = useState<number | ''>('');
  const [faltaMin, setFaltaMin] = useState<number | ''>('');
  const [almocoMin, setAlmocoMin] = useState<number | ''>('');
  const [almocoMax, setAlmocoMax] = useState<number | ''>('');
  const [interjMin, setInterjMin] = useState<number | ''>('');
  const [interjMax, setInterjMax] = useState<number | ''>('');

  const [departments, setDepartments] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [rows, setRows] = useState<AusenciaRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;

    const loadFilters = async () => {
      try {
        const [deps, emps] = await Promise.all([
          db.select('departments', [{ column: 'company_id', operator: 'eq', value: user.companyId }]),
          db.select('employees', [{ column: 'company_id', operator: 'eq', value: user.companyId }]),
        ]);

        setDepartments((deps ?? []) as any[]);
        setEmployees((emps ?? []) as any[]);
      } catch (e) {
        console.error(e);
      }
    };

    loadFilters();
  }, [user?.companyId]);

  const loadAusencias = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    if (!dataIni || !dataFim) return;

    setLoadingData(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.rpc('rel_ausencias', {
        p_data_ini: dataIni,
        p_data_fim: dataFim,
        p_user_id: employeeId || null,
        p_department_id: departmentId || null,
        p_carga_diaria_minutos: cargaDiaria,
        p_extra_minutos: extraMin === '' ? null : Number(extraMin),
        p_falta_minutos: faltaMin === '' ? null : Number(faltaMin),
        p_almoco_min_min: almocoMin === '' ? null : Number(almocoMin),
        p_almoco_min_max: almocoMax === '' ? null : Number(almocoMax),
        p_interjornada_min_min: interjMin === '' ? null : Number(interjMin),
        p_interjornada_min_max: interjMax === '' ? null : Number(interjMax),
        // p_company_id não é necessário no app; usa auth.uid()
      });

      if (error) {
        console.error(error);
        setErrorMsg(error.message || 'Erro ao carregar ausências.');
        setRows([]);
      } else {
        setRows((data ?? []) as AusenciaRow[]);
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || 'Erro ao carregar ausências.');
      setRows([]);
    } finally {
      setLoadingData(false);
    }
  };

  const exportCsv = () => {
    if (!rows.length) return;
    const header = [
      'Funcionário',
      'Nº Folha',
      'Empresa',
      'Departamento',
      'Data',
      'Min. Trabalhados',
      'Min. Extra',
      'Min. Falta',
      'Min. Almoço',
      'Min. Interjornada',
    ];
    const lines = rows.map((r) => [
      `"${r.nome}"`,
      r.numero_folha ?? '',
      r.empresa ?? '',
      r.departamento ?? '',
      r.data,
      r.minutos_trabalhados ?? '',
      r.minutos_extra ?? '',
      r.minutos_falta ?? '',
      r.minutos_almoco ?? '',
      r.minutos_interjornada ?? '',
    ]);
    const csv = [header.join(';'), ...lines.map((l) => l.join(';'))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ausencias_${dataIni}_${dataFim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const departmentsOptions = useMemo(
    () => departments.map((d) => ({ id: d.id, name: d.name })),
    [departments],
  );
  const employeesOptions = useMemo(
    () => employees.map((e) => ({ id: e.id, nome: e.nome || e.email })),
    [employees],
  );

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-4">
        <PageHeader
          title="Relatório de Ausências"
          subtitle="Análise de extras, faltas, intervalo de almoço e interjornada por dia e funcionário."
          icon={<CalendarDays size={24} />}
        />

        {/* Filtros */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Período inicial
              </label>
              <input
                type="date"
                value={dataIni}
                onChange={(e) => setDataIni(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Período final
              </label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Departamento
              </label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[160px]"
              >
                <option value="">Todos</option>
                {departmentsOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Funcionário
              </label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[200px]"
              >
                <option value="">Todos</option>
                {employeesOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Carga diária (min)
              </label>
              <input
                type="number"
                value={cargaDiaria}
                onChange={(e) => setCargaDiaria(Number(e.target.value) || 0)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-24"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Extra ≥ (min)
              </label>
              <input
                type="number"
                value={extraMin}
                onChange={(e) => setExtraMin(e.target.value === '' ? '' : Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-24"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Falta ≥ (min)
              </label>
              <input
                type="number"
                value={faltaMin}
                onChange={(e) => setFaltaMin(e.target.value === '' ? '' : Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-24"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Almoço (min) mín/máx
              </label>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={almocoMin}
                  onChange={(e) => setAlmocoMin(e.target.value === '' ? '' : Number(e.target.value))}
                  className="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-20"
                  placeholder="min"
                />
                <input
                  type="number"
                  value={almocoMax}
                  onChange={(e) => setAlmocoMax(e.target.value === '' ? '' : Number(e.target.value))}
                  className="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-20"
                  placeholder="máx"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Interjornada (min) mín/máx
              </label>
              <div className="flex gap-1">
                <input
                  type="number"
                  value={interjMin}
                  onChange={(e) => setInterjMin(e.target.value === '' ? '' : Number(e.target.value))}
                  className="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-20"
                  placeholder="min"
                />
                <input
                  type="number"
                  value={interjMax}
                  onChange={(e) => setInterjMax(e.target.value === '' ? '' : Number(e.target.value))}
                  className="px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-20"
                  placeholder="máx"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={loadAusencias}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700"
            >
              <Filter className="w-4 h-4" />
              Aplicar filtros
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!rows.length}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Exportar CSV
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Tabela */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-x-auto">
          {loadingData ? (
            <div className="p-12 text-center text-slate-500">Carregando...</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-slate-500">Nenhum registro com os filtros atuais.</div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Funcionário</th>
                  <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Nº Folha</th>
                  <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Empresa</th>
                  <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Departamento</th>
                  <th className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400">Data</th>
                  <th className="px-3 py-2 text-right font-bold text-slate-500 dark:text-slate-400">
                    Min. Trab.
                  </th>
                  <th className="px-3 py-2 text-right font-bold text-slate-500 dark:text-slate-400">
                    Min. Extra
                  </th>
                  <th className="px-3 py-2 text-right font-bold text-slate-500 dark:text-slate-400">
                    Min. Falta
                  </th>
                  <th className="px-3 py-2 text-right font-bold text-slate-500 dark:text-slate-400">
                    Min. Almoço
                  </th>
                  <th className="px-3 py-2 text-right font-bold text-slate-500 dark:text-slate-400">
                    Min. Interj.
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr
                    key={`${r.user_id}_${r.data}_${idx}`}
                    className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                  >
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.nome}</td>
                    <td className="px-3 py-1.5">{r.numero_folha ?? '—'}</td>
                    <td className="px-3 py-1.5">{r.empresa ?? '—'}</td>
                    <td className="px-3 py-1.5">{r.departamento ?? '—'}</td>
                    <td className="px-3 py-1.5">{r.data}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.minutos_trabalhados ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.minutos_extra ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.minutos_falta ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.minutos_almoco ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.minutos_interjornada ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </RoleGuard>
  );
};

export default AdminAusencias;