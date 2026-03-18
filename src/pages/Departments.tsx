import React, { useEffect, useState } from 'react';
import { Building2, Plus, Pencil, Trash2 } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { LoadingState } from '../../components/UI';
import RoleGuard from '../components/auth/RoleGuard';

interface DepartmentRow {
  id: string;
  name: string;
  numero_folha?: string;
  company_id: string;
  manager_id?: string;
  created_at: string;
}

const DepartmentsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<DepartmentRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [numeroFolha, setNumeroFolha] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = async () => {
    if (!user || !isSupabaseConfigured) {
      setLoadingData(false);
      return;
    }
    const companyId = user.companyId || user.id;
    setLoadingData(true);
    try {
      const data = (await db.select('departments', [
        { column: 'company_id', operator: 'eq', value: companyId },
      ])) as any[];
      setRows((data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name || '',
        numero_folha: r.numero_folha || '',
        company_id: r.company_id,
        manager_id: r.manager_id,
        created_at: r.created_at,
      })));
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: 'Erro ao carregar departamentos.' });
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

  const openCreate = () => {
    setEditingId(null);
    setName('');
    setNumeroFolha('');
    setModalOpen(true);
    setMessage(null);
    setModalError(null);
  };

  const openEdit = (row: DepartmentRow) => {
    setEditingId(row.id);
    setName(row.name);
    setNumeroFolha(row.numero_folha ?? '');
    setModalOpen(true);
    setMessage(null);
    setModalError(null);
  };

  const handleSave = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!isSupabaseConfigured) {
      setModalError('Supabase não configurado. Configure as variáveis de ambiente e reinicie.');
      return;
    }
    if (!user) {
      setModalError('Usuário não identificado. Faça login novamente.');
      return;
    }
    const companyId = user.companyId || user.id;
    const trimmed = name.trim();
    if (!trimmed) {
      setModalError('Informe o nome do departamento.');
      return;
    }
    setSaving(true);
    setModalError(null);
    setMessage(null);
    try {
      if (editingId) {
        await db.update('departments', editingId, {
          name: trimmed,
          numero_folha: numeroFolha.trim() || null,
        });
        setMessage({ type: 'success', text: 'Departamento atualizado com sucesso.' });
      } else {
        await db.insert('departments', {
          id: crypto.randomUUID(),
          company_id: companyId,
          name: trimmed,
          numero_folha: numeroFolha.trim() || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Departamento cadastrado com sucesso.' });
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
    if (!confirm('Excluir este departamento? Funcionários vinculados podem ficar sem departamento.')) return;
    try {
      await db.delete('departments', id);
      setMessage({ type: 'success', text: 'Departamento excluído.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir.' });
    }
  };

  if (loading || !user) return <LoadingState message="Carregando..." />;

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
            title="Departamentos"
            subtitle="Cadastro de departamentos para fins de cadastro de pessoas. Nº Folha pode ser exportado no arquivo de cálculos."
            icon={<Building2 size={24} />}
          />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-5 h-5" /> Incluir
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          {loadingData ? (
            <div className="p-12 text-center text-slate-500">Carregando...</div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nº Folha</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Descrição</th>
                    <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{row.numero_folha || '—'}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.name}</td>
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
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum departamento cadastrado. Clique em &quot;Novo departamento&quot; para começar.</p>
              )}
            </>
          )}
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !saving && setModalOpen(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar departamento' : 'Novo departamento'}</h3>
              {modalError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                  {modalError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nº Folha</label>
                <input
                  type="text"
                  value={numeroFolha}
                  onChange={(e) => { setNumeroFolha(e.target.value); setModalError(null); }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Número no sistema de folha (opcional)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setModalError(null); }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Ex: TI, Comercial, RH"
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

export default DepartmentsPage;
