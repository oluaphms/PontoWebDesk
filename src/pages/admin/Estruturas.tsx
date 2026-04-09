import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { GitBranch, Plus, Pencil, Trash2, UserPlus } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

interface EstruturaRow {
  id: string;
  codigo: string;
  descricao: string;
  parent_id: string | null;
  parent_descricao?: string;
  company_id: string;
  created_at: string;
  responsaveis?: { user_id: string; nome: string }[];
}

interface UserOption {
  id: string;
  nome: string;
}

const AdminEstruturas: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<EstruturaRow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [responsavelIds, setResponsavelIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadUsers = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    try {
      const data = (await db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as any[];
      setUsers((data ?? []).map((u: any) => ({
        id: u.id,
        nome: u.nome || u.full_name || u.email || u.id,
      })));
    } catch (e) {
      console.error(e);
    }
  };

  const load = async () => {
    if (!user?.companyId || !isSupabaseConfigured) {
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    try {
      const estruturasData = (await db.select('estruturas', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as any[];
      const list: EstruturaRow[] = (estruturasData ?? []).map((r: any) => ({
        id: r.id,
        codigo: r.codigo || '',
        descricao: r.descricao || '',
        parent_id: r.parent_id ?? null,
        company_id: r.company_id,
        created_at: r.created_at,
        responsaveis: [],
      }));
      const parentMap = new Map(list.map((e) => [e.id, e]));
      list.forEach((e) => {
        if (e.parent_id) {
          const parent = parentMap.get(e.parent_id);
          if (parent) e.parent_descricao = parent.descricao;
        }
      });
      if (supabase) {
        const { data: respData } = await supabase.from('estrutura_responsaveis').select('estrutura_id, user_id');
        const respMap = new Map<string, string[]>();
        (respData ?? []).forEach((r: any) => {
          if (!respMap.has(r.estrutura_id)) respMap.set(r.estrutura_id, []);
          respMap.get(r.estrutura_id)!.push(r.user_id);
        });
        const { data: userNames } = await supabase.from('users').select('id, nome, full_name, email');
        const nameMap = new Map((userNames ?? []).map((u: any) => [u.id, u.nome || u.full_name || u.email || u.id]));
        list.forEach((e) => {
          const ids = respMap.get(e.id) ?? [];
          e.responsaveis = ids.map((user_id) => ({ user_id, nome: nameMap.get(user_id) || user_id }));
        });
      }
      setRows(list);
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: 'Erro ao carregar estruturas.' });
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [user?.companyId]);

  useEffect(() => {
    load();
  }, [user?.companyId]);

  const openCreate = () => {
    setEditingId(null);
    setCodigo('');
    setDescricao('');
    setParentId('');
    setResponsavelIds([]);
    setModalOpen(true);
    setMessage(null);
    setModalError(null);
  };

  const openEdit = (row: EstruturaRow) => {
    setEditingId(row.id);
    setCodigo(row.codigo);
    setDescricao(row.descricao);
    setParentId(row.parent_id ?? '');
    setResponsavelIds((row.responsaveis ?? []).map((r) => r.user_id));
    setModalOpen(true);
    setMessage(null);
    setModalError(null);
  };

  const toggleResponsavel = (userId: string) => {
    setResponsavelIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSave = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!isSupabaseConfigured || !user?.companyId) {
      setModalError('Configuração ou empresa não identificada.');
      return;
    }
    const codigoTrim = codigo.trim();
    const descTrim = descricao.trim();
    if (!codigoTrim) {
      setModalError('Informe o código da estrutura. Não devem existir códigos repetidos.');
      return;
    }
    if (!descTrim) {
      setModalError('Informe a descrição da estrutura.');
      return;
    }
    setSaving(true);
    setModalError(null);
    setMessage(null);
    try {
      const parentIdVal = parentId.trim() || null;
      if (editingId) {
        await db.update('estruturas', editingId, {
          codigo: codigoTrim,
          descricao: descTrim,
          parent_id: parentIdVal,
        });
        if (supabase) {
          await supabase.from('estrutura_responsaveis').delete().eq('estrutura_id', editingId);
          for (const uid of responsavelIds) {
            await supabase.from('estrutura_responsaveis').insert({
              id: crypto.randomUUID(),
              estrutura_id: editingId,
              user_id: uid,
              created_at: new Date().toISOString(),
            });
          }
        }
        setMessage({ type: 'success', text: 'Estrutura atualizada com sucesso.' });
      } else {
        const newId = crypto.randomUUID();
        await db.insert('estruturas', {
          id: newId,
          company_id: user.companyId,
          codigo: codigoTrim,
          descricao: descTrim,
          parent_id: parentIdVal,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (supabase && responsavelIds.length > 0) {
          for (const uid of responsavelIds) {
            await supabase.from('estrutura_responsaveis').insert({
              id: crypto.randomUUID(),
              estrutura_id: newId,
              user_id: uid,
              created_at: new Date().toISOString(),
            });
          }
        }
        setMessage({ type: 'success', text: 'Estrutura cadastrada com sucesso.' });
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
    if (!confirm('Excluir esta estrutura? Subordinados e vínculos de funcionários podem ficar órfãos.')) return;
    try {
      await db.delete('estruturas', id);
      setMessage({ type: 'success', text: 'Estrutura excluída.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir.' });
    }
  };

  const parentOptions = rows.filter((r) => !editingId || r.id !== editingId);

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
            title="Estruturas"
            subtitle="Cadastro do organograma (cadeia de comando). Utilizado para filtro de relatórios. Vincule a pessoa em Cadastro > Funcionários."
            icon={<GitBranch size={24} />}
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Código</th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Descrição</th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Dentro de</th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Responsáveis</th>
                      <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">{row.codigo}</td>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.descricao}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{row.parent_descricao || 'Início'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {(row.responsaveis ?? []).length > 0
                            ? (row.responsaveis ?? []).map((r) => r.nome).join(', ')
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center">
                            <button type="button" onClick={() => openEdit(row)} className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg" title="Editar">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button type="button" onClick={() => handleDelete(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg" title="Excluir">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!loadingData && rows.length === 0 && (
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhuma estrutura cadastrada. Clique em &quot;Incluir&quot; para começar.</p>
              )}
            </>
          )}
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !saving && setModalOpen(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar estrutura' : 'Nova estrutura'}</h3>
              {modalError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                  {modalError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Código</label>
                <input
                  type="text"
                  value={codigo}
                  onChange={(e) => { setCodigo(e.target.value); setModalError(null); }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Código único no sistema"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                <input
                  type="text"
                  value={descricao}
                  onChange={(e) => { setDescricao(e.target.value); setModalError(null); }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Ex: Diretor Comercial, Gerente de Vendas"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Dentro de</label>
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Início (sem estrutura superior)</option>
                  {parentOptions.map((p) => (
                    <option key={p.id} value={p.id}>{p.descricao} ({p.codigo})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  <UserPlus className="w-4 h-4 inline mr-1" /> Responsável(is)
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Selecione um ou mais responsáveis (Mais Responsáveis)</p>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border border-slate-200 dark:border-slate-700 rounded-xl">
                  {users.map((u) => (
                    <label key={u.id} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={responsavelIds.includes(u.id)}
                        onChange={() => toggleResponsavel(u.id)}
                        className="rounded border-slate-300"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300">{u.nome}</span>
                    </label>
                  ))}
                  {users.length === 0 && <span className="text-sm text-slate-500">Nenhum usuário na empresa.</span>}
                </div>
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

export default AdminEstruturas;
