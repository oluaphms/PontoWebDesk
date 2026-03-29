import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock, Trash2, History } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

interface ArquivamentoRow {
  id: string;
  company_id: string;
  data_inicio: string;
  data_fim: string;
  arquivado_em: string;
  arquivado_por: string;
  usuario_nome?: string;
}

const formatDateBr = (d: string) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};

const AdminArquivarCalculos: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [dataLimite, setDataLimite] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<ArquivamentoRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    if (!user?.companyId || !isSupabaseConfigured) {
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    try {
      const data = (await db.select(
        'arquivamento_calculos',
        [{ column: 'company_id', operator: 'eq', value: user.companyId }],
        { column: 'arquivado_em', ascending: false },
      )) as any[];
      setRows(
        (data ?? []).map((r: any) => ({
          id: r.id,
          company_id: r.company_id,
          data_inicio: r.data_inicio,
          data_fim: r.data_fim,
          arquivado_em: r.arquivado_em,
          arquivado_por: r.arquivado_por,
        })),
      );
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: 'Erro ao carregar períodos arquivados.' });
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

  const handleArquivar = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    if (!dataLimite) {
      setMessage({ type: 'error', text: 'Informe uma data limite.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      // data_inicio: início após o último arquivamento ou 1900-01-01
      let dataInicio = '1900-01-01';
      if (rows.length > 0) {
        const ultima = rows.reduce(
          (acc, r) => (r.data_fim > acc.data_fim ? r : acc),
          rows[0],
        );
        const d = new Date(ultima.data_fim);
        d.setDate(d.getDate() + 1);
        dataInicio = d.toISOString().slice(0, 10);
      }
      await db.insert('arquivamento_calculos', {
        id: crypto.randomUUID(),
        company_id: user.companyId,
        data_inicio: dataInicio,
        data_fim: dataLimite,
        arquivado_em: new Date().toISOString(),
        arquivado_por: user.id,
      });
      setMessage({ type: 'success', text: `Cálculos anteriores a ${formatDateBr(dataLimite)} foram arquivados.` });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao arquivar cálculos.' });
    } finally {
      setSaving(false);
    }
  };

  const handleExcluirUltimo = async () => {
    if (!rows.length || !isSupabaseConfigured) return;
    const ultimo = rows[0];
    if (!confirm('Excluir o último período arquivado?')) return;
    try {
      await db.delete('arquivamento_calculos', ultimo.id);
      setMessage({ type: 'success', text: 'Último período arquivado excluído.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir período.' });
    }
  };

  const handleExcluirTodos = async () => {
    if (!rows.length || !isSupabaseConfigured) return;
    if (!confirm('Excluir TODOS os períodos arquivados?')) return;
    try {
      for (const r of rows) {
        await db.delete('arquivamento_calculos', r.id);
      }
      setMessage({ type: 'success', text: 'Todos os períodos arquivados foram excluídos.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir períodos.' });
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin']}>
      <div className="space-y-4">
        <PageHeader
          title="Arquivar Cálculos"
          subtitle="Arquiva cálculos anteriores à data informada, protegendo-os contra alterações. Apenas administradores podem arquivar cálculos."
          icon={<Lock size={24} />}
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

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            <strong>Arquivar dados antes de:</strong> todos os cálculos anteriores à data informada serão arquivados e não poderão ser alterados.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Data limite
              </label>
              <input
                type="date"
                value={dataLimite}
                onChange={(e) => setDataLimite(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <button
              type="button"
              onClick={handleArquivar}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              <History className="w-4 h-4" /> {saving ? 'Arquivando...' : 'OK (Arquivar)'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Períodos já arquivados</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleExcluirUltimo}
                disabled={!rows.length}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 text-xs"
              >
                <Trash2 className="w-3 h-3" /> Excluir último
              </button>
              <button
                type="button"
                onClick={handleExcluirTodos}
                disabled={!rows.length}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 text-xs"
              >
                <Trash2 className="w-3 h-3" /> Excluir todos
              </button>
            </div>
          </div>
          {loadingData ? (
            <div className="p-8 text-center text-slate-500">Carregando...</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-slate-500">Nenhum período arquivado.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-4 py-2 font-bold text-slate-500 dark:text-slate-400">Data início</th>
                  <th className="text-left px-4 py-2 font-bold text-slate-500 dark:text-slate-400">Data fim</th>
                  <th className="text-left px-4 py-2 font-bold text-slate-500 dark:text-slate-400">Arquivado em</th>
                  <th className="text-left px-4 py-2 font-bold text-slate-500 dark:text-slate-400">Usuário</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-2 whitespace-nowrap">{formatDateBr(r.data_inicio)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDateBr(r.data_fim)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {new Date(r.arquivado_em).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">ID: {r.arquivado_por}</td>
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

export default AdminArquivarCalculos;

