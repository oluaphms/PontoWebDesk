import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Calendar, Plus, Pencil, Trash2, Sparkles } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

interface FeriadoRow {
  id: string;
  data: string;
  descricao: string;
  company_id: string;
  created_at: string;
}

/** Feriados nacionais e datas fixas do ano (padrões) */
const FERIADOS_PADROES: { dia: number; mes: number; descricao: string }[] = [
  { dia: 1, mes: 1, descricao: 'Ano Novo' },
  { dia: 21, mes: 4, descricao: 'Tiradentes' },
  { dia: 1, mes: 5, descricao: 'Dia do Trabalho' },
  { dia: 7, mes: 9, descricao: 'Independência do Brasil' },
  { dia: 12, mes: 10, descricao: 'Nossa Senhora Aparecida' },
  { dia: 2, mes: 11, descricao: 'Finados' },
  { dia: 15, mes: 11, descricao: 'Proclamação da República' },
  { dia: 25, mes: 12, descricao: 'Natal' },
];

const AdminFeriados: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<FeriadoRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [data, setData] = useState('');
  const [descricao, setDescricao] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingPadroes, setLoadingPadroes] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = async () => {
    if (!user?.companyId || !isSupabaseConfigured) {
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    try {
      const result = (await db.select('feriados', [{ column: 'company_id', operator: 'eq', value: user.companyId }], { column: 'data', ascending: true })) as any[];
      setRows((result ?? []).map((r: any) => ({
        id: r.id,
        data: r.data,
        descricao: r.descricao || '',
        company_id: r.company_id,
        created_at: r.created_at,
      })));
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: 'Erro ao carregar feriados.' });
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

  const openCreate = () => {
    setEditingId(null);
    setData('');
    setDescricao('');
    setModalOpen(true);
    setMessage(null);
    setModalError(null);
  };

  const openEdit = (row: FeriadoRow) => {
    setEditingId(row.id);
    setData(row.data);
    setDescricao(row.descricao);
    setModalOpen(true);
    setMessage(null);
    setModalError(null);
  };

  const handleSave = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!isSupabaseConfigured || !user?.companyId) {
      setModalError('Configuração ou empresa não identificada.');
      return;
    }
    if (!data.trim()) {
      setModalError('Informe a data do feriado.');
      return;
    }
    if (!descricao.trim()) {
      setModalError('Informe a descrição do feriado.');
      return;
    }
    setSaving(true);
    setModalError(null);
    setMessage(null);
    try {
      if (editingId) {
        await db.update('feriados', editingId, { data: data.trim(), descricao: descricao.trim() });
        setMessage({ type: 'success', text: 'Feriado atualizado com sucesso.' });
      } else {
        await db.insert('feriados', {
          id: crypto.randomUUID(),
          company_id: user.companyId,
          data: data.trim(),
          descricao: descricao.trim(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Feriado cadastrado com sucesso.' });
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      const text = err?.message || err?.error?.message || 'Erro ao salvar. Tente novamente.';
      setModalError(text);
      setMessage({ type: 'error', text });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este feriado?')) return;
    try {
      await db.delete('feriados', id);
      setMessage({ type: 'success', text: 'Feriado excluído.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir.' });
    }
  };

  const aplicarPadroes = async () => {
    if (!user?.companyId || !isSupabaseConfigured) {
      setMessage({ type: 'error', text: 'Configuração ou empresa não identificada.' });
      return;
    }
    const year = new Date().getFullYear();
    setLoadingPadroes(true);
    setMessage(null);
    try {
      const existentes = new Set(rows.map((r) => r.data));
      let inseridos = 0;
      for (const f of FERIADOS_PADROES) {
        const dataStr = `${year}-${String(f.mes).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`;
        if (existentes.has(dataStr)) continue;
        await db.insert('feriados', {
          id: crypto.randomUUID(),
          company_id: user.companyId,
          data: dataStr,
          descricao: f.descricao,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        existentes.add(dataStr);
        inseridos++;
      }
      setMessage({ type: 'success', text: `Padrões aplicados: ${inseridos} feriados nacionais do ano ${year} cadastrados.` });
      load();
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Erro ao aplicar padrões.' });
    } finally {
      setLoadingPadroes(false);
    }
  };

  const formatData = (d: string) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-6">
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <PageHeader
            title="Feriados"
            subtitle="Cadastro de feriados. Utilizados no cadastro de horários."
            icon={<Calendar size={24} />}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={aplicarPadroes}
              disabled={loadingPadroes}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-xl font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              <Sparkles className="w-5 h-5" /> Padrões
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
            >
              <Plus className="w-5 h-5" /> Incluir
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          O botão <strong>Padrões</strong> cadastra os feriados nacionais e datas fixas do ano corrente.
        </p>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          {loadingData ? (
            <div className="p-12 text-center text-slate-500">Carregando...</div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Data</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Descrição</th>
                    <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{formatData(row.data)}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{row.descricao}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => openEdit(row)} className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg" title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => handleDelete(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loadingData && rows.length === 0 && (
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum feriado cadastrado. Use &quot;Padrões&quot; ou &quot;Incluir&quot; para começar.</p>
              )}
            </>
          )}
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !saving && setModalOpen(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar feriado' : 'Novo feriado'}</h3>
              {modalError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                  {modalError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                <input
                  type="date"
                  value={data}
                  onChange={(e) => { setData(e.target.value); setModalError(null); }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                <input
                  type="text"
                  value={descricao}
                  onChange={(e) => { setDescricao(e.target.value); setModalError(null); }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Descrição do feriado"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">
                  Cancelar
                </button>
                <button type="button" onClick={(e) => handleSave(e)} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? 'Salvando...' : 'Concluir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
};

export default AdminFeriados;
