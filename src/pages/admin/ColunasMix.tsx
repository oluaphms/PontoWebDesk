import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, Plus, Pencil, Trash2 } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

type Operacao = 'soma' | 'subtracao';

interface ColunaMixRow {
  id: string;
  company_id: string;
  nome: string;
  exibir_em: 'horas' | 'dias';
  operacoes: { coluna: string; operacao: Operacao }[];
  created_at: string;
}

const COLUMN_OPTIONS = [
  'Normais',
  'Faltas',
  'ExUt',
  'ExSa',
  'ExDo',
  'ExFe',
  'DSR',
  'DSR Deb.',
  'Not.',
  'Ajuste',
  'Abo. 2',
  'Abo. 3',
  'Abo. 4',
  'Adian.',
  'Atras.',
  'Carga',
  'BSaldo',
  'Bcred',
  'Bdeb',
  'Bajust',
  'ExNot',
];

const AdminColunasMix: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<ColunaMixRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [exibirEm, setExibirEm] = useState<'horas' | 'dias'>('horas');
  const [items, setItems] = useState<{ coluna: string; operacao: Operacao }[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = async () => {
    if (!user?.companyId || !isSupabaseConfigured) {
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    try {
      const data = (await db.select(
        'colunas_mix',
        [{ column: 'company_id', operator: 'eq', value: user.companyId }],
        { column: 'created_at', ascending: true },
      )) as any[];
      setRows(
        (data ?? []).map((r: any) => ({
          id: r.id,
          company_id: r.company_id,
          nome: r.nome,
          exibir_em: r.exibir_em,
          operacoes: Array.isArray(r.operacoes) ? r.operacoes : [],
          created_at: r.created_at,
        })),
      );
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: 'Erro ao carregar colunas mix.' });
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

  const openCreate = () => {
    setEditingId(null);
    setNome('');
    setExibirEm('horas');
    setItems([]);
    setModalOpen(true);
    setModalError(null);
    setMessage(null);
  };

  const openEdit = (row: ColunaMixRow) => {
    setEditingId(row.id);
    setNome(row.nome);
    setExibirEm(row.exibir_em);
    setItems(row.operacoes || []);
    setModalOpen(true);
    setModalError(null);
    setMessage(null);
  };

  const addItem = () => {
    const firstAvailable = COLUMN_OPTIONS.find(
      (c) => !items.some((i) => i.coluna === c),
    );
    setItems((prev) => [...prev, { coluna: firstAvailable || '', operacao: 'soma' }]);
  };

  const updateItem = (index: number, patch: Partial<{ coluna: string; operacao: Operacao }>) => {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    );
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!user?.companyId || !isSupabaseConfigured) {
      setModalError('Configuração ou empresa não identificada.');
      return;
    }
    const nomeTrim = nome.trim();
    if (!nomeTrim) {
      setModalError('Informe o nome da coluna mix.');
      return;
    }
    if (!items.length) {
      setModalError('Inclua pelo menos uma coluna para mixar.');
      return;
    }
    setSaving(true);
    setModalError(null);
    setMessage(null);
    try {
      const payload = {
        nome: nomeTrim,
        exibir_em: exibirEm,
        operacoes: items,
      };
      if (editingId) {
        await db.update('colunas_mix', editingId, payload);
        setMessage({ type: 'success', text: 'Coluna mix atualizada.' });
      } else {
        await db.insert('colunas_mix', {
          id: crypto.randomUUID(),
          company_id: user.companyId,
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Coluna mix criada.' });
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      const text = err?.message || err?.error?.message || 'Erro ao salvar.';
      setModalError(text);
      setMessage({ type: 'error', text });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta coluna mix?')) return;
    try {
      await db.delete('colunas_mix', id);
      setMessage({ type: 'success', text: 'Coluna mix excluída.' });
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
            title="Colunas Mix"
            subtitle="Agrupe várias colunas de cálculo em uma única coluna mix (ex.: Not.Tot)."
            icon={<SlidersHorizontal size={24} />}
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
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Nome</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Exibir em</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Colunas a mixar</th>
                    <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.nome}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {row.exibir_em === 'horas' ? 'Horas' : 'Dias'}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                        {row.operacoes?.length
                          ? row.operacoes
                              .map((op) => `${op.coluna} (${op.operacao === 'soma' ? '+' : '-'})`)
                              .join('  ·  ')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="p-2 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg"
                          title="Editar"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row.id)}
                          className="p-2 text-slate-500 hover:text-red-600 rounded-lg"
                          title="Excluir"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loadingData && rows.length === 0 && (
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">
                  Nenhuma coluna mix cadastrada. Clique em &quot;Incluir&quot; para criar.
                </p>
              )}
            </>
          )}
        </div>

        {modalOpen && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={() => !saving && setModalOpen(false)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {editingId ? 'Editar coluna mix' : 'Nova coluna mix'}
              </h3>
              {modalError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                  {modalError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nome da coluna mix
                  </label>
                  <input
                    type="text"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    placeholder="Ex: Not.Tot"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Exibir resultado em
                  </label>
                  <select
                    value={exibirEm}
                    onChange={(e) =>
                      setExibirEm((e.target.value as 'horas' | 'dias') || 'horas')
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    <option value="horas">Horas</option>
                    <option value="dias">Dias (conforme carga horária)</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">
                    Colunas a mixar
                  </span>
                  <button
                    type="button"
                    onClick={addItem}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
                  >
                    <Plus className="w-3 h-3" /> Adicionar coluna
                  </button>
                </div>
                {items.length === 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Nenhuma coluna selecionada. Clique em &quot;Adicionar coluna&quot; para começar.
                  </p>
                )}
                <div className="space-y-2 mt-2">
                  {items.map((item, index) => (
                    <div
                      key={index}
                      className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700"
                    >
                      <select
                        value={item.coluna}
                        onChange={(e) =>
                          updateItem(index, { coluna: e.target.value })
                        }
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                      >
                        <option value="">Selecione a coluna...</option>
                        {COLUMN_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <select
                        value={item.operacao}
                        onChange={(e) =>
                          updateItem(index, {
                            operacao: (e.target.value as Operacao) || 'soma',
                          })
                        }
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                      >
                        <option value="soma">Somar (+)</option>
                        <option value="subtracao">Subtrair (−)</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="ml-auto p-1.5 text-slate-500 hover:text-red-600 rounded-lg"
                        title="Remover"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={(e) => handleSave(e)}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
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

export default AdminColunasMix;

