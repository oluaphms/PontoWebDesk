import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CalendarClock, Plus, Pencil, Trash2 } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

interface EventoRow {
  id: string;
  codigo: string;
  descricao: string;
  incluir_automaticamente: boolean;
  dia_padrao: number | null;
  unitario_padrao: number | null;
  usar_dias_uteis_quantidade: boolean;
  company_id: string;
  created_at: string;
}

const AdminEventos: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<EventoRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [incluirAutomaticamente, setIncluirAutomaticamente] = useState(false);
  const [diaPadrao, setDiaPadrao] = useState<string>('');
  const [unitarioPadrao, setUnitarioPadrao] = useState<string>('');
  const [usarDiasUteisQuantidade, setUsarDiasUteisQuantidade] = useState(false);
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
      const data = (await db.select('eventos_folha', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as any[];
      setRows((data ?? []).map((r: any) => ({
        id: r.id,
        codigo: r.codigo || '',
        descricao: r.descricao || '',
        incluir_automaticamente: !!r.incluir_automaticamente,
        dia_padrao: r.dia_padrao ?? null,
        unitario_padrao: r.unitario_padrao ?? null,
        usar_dias_uteis_quantidade: !!r.usar_dias_uteis_quantidade,
        company_id: r.company_id,
        created_at: r.created_at,
      })));
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: 'Erro ao carregar eventos.' });
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

  const openCreate = () => {
    setEditingId(null);
    setCodigo('');
    setDescricao('');
    setIncluirAutomaticamente(false);
    setDiaPadrao('');
    setUnitarioPadrao('');
    setUsarDiasUteisQuantidade(false);
    setModalOpen(true);
    setMessage(null);
    setModalError(null);
  };

  const openEdit = (row: EventoRow) => {
    setEditingId(row.id);
    setCodigo(row.codigo);
    setDescricao(row.descricao);
    setIncluirAutomaticamente(row.incluir_automaticamente);
    setDiaPadrao(row.dia_padrao != null ? String(row.dia_padrao) : '');
    setUnitarioPadrao(row.unitario_padrao != null ? String(row.unitario_padrao) : '');
    setUsarDiasUteisQuantidade(row.usar_dias_uteis_quantidade);
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
    const codigoTrim = codigo.trim();
    const descTrim = descricao.trim();
    if (!codigoTrim) {
      setModalError('Informe o código do evento (mesmo do programa de Folha de Pagamento).');
      return;
    }
    if (!descTrim) {
      setModalError('Informe a descrição do evento.');
      return;
    }
    setSaving(true);
    setModalError(null);
    setMessage(null);
    try {
      const payload = {
        codigo: codigoTrim,
        descricao: descTrim,
        incluir_automaticamente: incluirAutomaticamente,
        dia_padrao: diaPadrao === '' ? null : parseInt(diaPadrao, 10),
        unitario_padrao: unitarioPadrao === '' ? null : parseFloat(unitarioPadrao.replace(',', '.')),
        usar_dias_uteis_quantidade: usarDiasUteisQuantidade,
      };
      if (editingId) {
        await db.update('eventos_folha', editingId, payload);
        setMessage({ type: 'success', text: 'Evento atualizado com sucesso.' });
      } else {
        await db.insert('eventos_folha', {
          id: crypto.randomUUID(),
          company_id: user.companyId,
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Evento cadastrado com sucesso.' });
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
    if (!confirm('Excluir este evento?')) return;
    try {
      await db.delete('eventos_folha', id);
      setMessage({ type: 'success', text: 'Evento excluído.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir.' });
    }
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
            title="Eventos"
            subtitle="Eventos usados nos programas de Folha de Pagamento (Vales, Ordens, Adiantamentos, etc.)"
            icon={<CalendarClock size={24} />}
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
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Código</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Descrição</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Auto</th>
                    <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">{row.codigo}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.descricao}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{row.incluir_automaticamente ? 'Sim' : 'Não'}</td>
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
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhum evento cadastrado. Clique em &quot;Incluir&quot; para começar.</p>
              )}
            </>
          )}
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !saving && setModalOpen(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar evento' : 'Novo evento'}</h3>
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
                  placeholder="Mesmo código do programa de Folha de Pagamento"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                <input
                  type="text"
                  value={descricao}
                  onChange={(e) => { setDescricao(e.target.value); setModalError(null); }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Ex: Vale Transporte, Adiantamento"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={incluirAutomaticamente} onChange={(e) => setIncluirAutomaticamente(e.target.checked)} className="rounded border-slate-300" />
                <span className="text-sm text-slate-700 dark:text-slate-300">Incluir automaticamente para todos os funcionários</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Dia padrão</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={diaPadrao}
                  onChange={(e) => setDiaPadrao(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Dia do mês para lançamento automático"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Unitário padrão (valor)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={unitarioPadrao}
                  onChange={(e) => setUnitarioPadrao(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Valor do evento"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={usarDiasUteisQuantidade} onChange={(e) => setUsarDiasUteisQuantidade(e.target.checked)} className="rounded border-slate-300" />
                <span className="text-sm text-slate-700 dark:text-slate-300">Utilizar dias úteis do mês para quantidade</span>
              </label>
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

export default AdminEventos;
