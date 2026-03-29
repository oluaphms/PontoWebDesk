import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { FileText, Download } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

interface EmployeeRow {
  id: string;
  nome: string;
  department_id?: string;
}

type TipoArquivo = 'tratados' | 'jornadas';

const AdminArquivosFiscais: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [periodStart, setPeriodStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [employeeId, setEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [tipoArquivo, setTipoArquivo] = useState<TipoArquivo>('tratados');
  const [loadingData, setLoadingData] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) {
      setLoadingData(false);
      return;
    }
    const load = async () => {
      setLoadingData(true);
      try {
        const [usersRows, deptRows] = await Promise.all([
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('departments', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);
        setEmployees(
          (usersRows ?? []).map((u: any) => ({
            id: u.id,
            nome: u.nome || u.email || '',
            department_id: u.department_id,
          })),
        );
        setDepartments(
          (deptRows ?? []).map((d: any) => ({
            id: d.id,
            name: d.name || d.id,
          })),
        );
      } catch (e) {
        console.error(e);
        setMessage({ type: 'error', text: 'Erro ao carregar dados para arquivos fiscais.' });
      } finally {
        setLoadingData(false);
      }
    };
    load();
  }, [user?.companyId]);

  const handleGenerate = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    if (!periodStart || !periodEnd) {
      setMessage({ type: 'error', text: 'Informe o período para geração do arquivo.' });
      return;
    }
    setGenerating(true);
    setMessage(null);
    try {
      const filters: { column: string; operator: string; value: any }[] = [
        { column: 'company_id', operator: 'eq', value: user.companyId },
        { column: 'created_at', operator: 'gte', value: periodStart },
        { column: 'created_at', operator: 'lte', value: `${periodEnd}T23:59:59` },
      ];
      if (employeeId) filters.push({ column: 'user_id', operator: 'eq', value: employeeId });
      const recs = (await db.select('time_records', filters, { column: 'created_at', ascending: true }, 10000)) as any[];

      if (!recs.length) {
        setMessage({ type: 'error', text: 'Nenhum registro encontrado no período selecionado.' });
        return;
      }

      let content = '';
      let filename = '';

      if (tipoArquivo === 'tratados') {
        // Fonte de Dados Tratados – simplificado: um registro por marcação com campos essenciais.
        filename = `fonte_dados_tratados_${periodStart}_${periodEnd}.txt`;
        const lines = recs.map((r) => {
          const func = employees.find((e) => e.id === r.user_id);
          const dept = departments.find((d) => d.id === func?.department_id);
          const date = (r.created_at || '').slice(0, 10);
          const time = r.created_at ? new Date(r.created_at).toISOString().slice(11, 19) : '';
          return [
            r.id,
            r.user_id,
            func?.nome ?? '',
            dept?.name ?? '',
            date,
            time,
            r.type,
            r.method,
          ].join(';');
        });
        content = lines.join('\n');
      } else {
        // Controle de Jornadas para Efeitos Fiscais – agrupado por empregado e dia.
        filename = `controle_jornadas_${periodStart}_${periodEnd}.txt`;
        const byUserDate = new Map<string, { userId: string; date: string; entries: string[]; exits: string[] }>();
        recs.forEach((r: any) => {
          const d = (r.created_at || '').slice(0, 10);
          const key = `${r.user_id}_${d}`;
          const entry = byUserDate.get(key) || { userId: r.user_id, date: d, entries: [], exits: [] };
          const time = r.created_at ? new Date(r.created_at).toISOString().slice(11, 19) : '';
          if (r.type === 'entrada') entry.entries.push(time);
          else if (r.type === 'saída') entry.exits.push(time);
          byUserDate.set(key, entry);
        });
        const lines: string[] = [];
        byUserDate.forEach((v) => {
          const func = employees.find((e) => e.id === v.userId);
          const dept = departments.find((d) => d.id === func?.department_id);
          lines.push(
            [
              v.userId,
              func?.nome ?? '',
              dept?.name ?? '',
              v.date,
              v.entries.join('|'),
              v.exits.join('|'),
            ].join(';'),
          );
        });
        content = lines.join('\n');
      }

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: 'Arquivo fiscal gerado com sucesso.' });
    } catch (e: any) {
      console.error(e);
      setMessage({ type: 'error', text: e?.message || 'Erro ao gerar arquivo fiscal.' });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin']}>
      <div className="space-y-4">
        <PageHeader
          title="Geração de Arquivos Fiscais"
          subtitle="Gere arquivos de Fonte de Dados Tratados e Controle de Jornadas para Portaria 1510."
          icon={<FileText size={24} />}
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

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4 space-y-4">
          {loadingData ? (
            <div className="p-8 text-center text-slate-500">Carregando dados...</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Período (início)
                  </label>
                  <input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Período (fim)
                  </label>
                  <input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Tipo de arquivo
                  </label>
                  <select
                    value={tipoArquivo}
                    onChange={(e) => setTipoArquivo(e.target.value as TipoArquivo)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="tratados">Fonte de Dados Tratados</option>
                    <option value="jornadas">Controle de Jornadas para Efeitos Fiscais</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Funcionário
                  </label>
                  <select
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">(geral)</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Departamento
                  </label>
                  <select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="">(todos)</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    O filtro de departamento será aplicado apenas na seleção de funcionários para geração do arquivo.
                  </p>
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" /> {generating ? 'Gerando...' : 'Gerar arquivo'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </RoleGuard>
  );
};

export default AdminArquivosFiscais;

