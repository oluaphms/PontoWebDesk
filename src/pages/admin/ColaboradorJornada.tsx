import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Calendar, Clock, Users, Search, X, CheckCircle, XCircle } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';

interface VinculoRow {
  id: string;
  colaborador_id: string;
  colaborador_nome: string;
  horario_id: string | null;
  horario_nome: string | null;
  escala_id: string | null;
  escala_nome: string | null;
  data_inicio: string;
  data_fim: string | null;
  ativo: boolean;
}

interface Colaborador {
  id: string;
  nome: string;
  email: string;
  cargo?: string;
}

interface Horario {
  id: string;
  name: string;
  description?: string;
}

interface Escala {
  id: string;
  name: string;
  tipo?: string;
}

const formatDate = (d: string | null): string => {
  if (!d) return '—';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('pt-BR');
};

const ColaboradorJornada: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<VinculoRow[]>([]);
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [escalas, setEscalas] = useState<Escala[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // Filtros
  const [filterColaborador, setFilterColaborador] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  
  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    colaborador_id: '',
    horario_id: '',
    escala_id: '',
    data_inicio: new Date().toISOString().slice(0, 10),
    data_fim: '',
    ativo: true,
  });
  const [saving, setSaving] = useState(false);
  
  // Picker de colaborador
  const [colaboradorPickerOpen, setColaboradorPickerOpen] = useState(false);
  const [colaboradorSearch, setColaboradorSearch] = useState('');

  const load = async () => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    setLoadingData(true);
    try {
      const [vinculos, users, shifts, schedules] = await Promise.all([
        db.select('colaborador_jornada', [{ column: 'company_id', operator: 'eq', value: user.companyId }]).catch(() => []) as Promise<any[]>,
        db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('work_shifts', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('schedules', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
      ]);
      
      const userMap = new Map((users ?? []).map((u: any) => [u.id, { nome: u.nome || u.email || 'Sem nome', email: u.email, cargo: u.cargo }]));
      const shiftMap = new Map((shifts ?? []).map((s: any) => [s.id, s.name]));
      const scheduleMap = new Map((schedules ?? []).map((s: any) => [s.id, s.name]));
      
      setColaboradores((users ?? []).map((u: any) => ({
        id: u.id,
        nome: u.nome || u.email || 'Sem nome',
        email: u.email,
        cargo: u.cargo,
      })));
      
      setHorarios((shifts ?? []).filter((s: any) => s.ativo !== false).map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })));
      
      setEscalas((schedules ?? []).filter((s: any) => s.ativo !== false).map((s: any) => ({
        id: s.id,
        name: s.name,
        tipo: s.tipo,
      })));
      
      setRows((vinculos ?? []).map((v: any) => ({
        id: v.id,
        colaborador_id: v.colaborador_id,
        colaborador_nome: userMap.get(v.colaborador_id)?.nome || 'Colaborador não encontrado',
        horario_id: v.horario_id,
        horario_nome: v.horario_id ? shiftMap.get(v.horario_id) : null,
        escala_id: v.escala_id,
        escala_nome: v.escala_id ? scheduleMap.get(v.escala_id) : null,
        data_inicio: v.data_inicio,
        data_fim: v.data_fim,
        ativo: v.ativo ?? true,
      })));
    } catch (e) {
      observabilityConsole.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

  const isVinculoActive = (row: VinculoRow): boolean => {
    if (!row.ativo) return false;
    const hoje = new Date().toISOString().slice(0, 10);
    if (row.data_inicio > hoje) return false;
    if (row.data_fim && row.data_fim < hoje) return false;
    return true;
  };

  const filteredRows = rows.filter((row) => {
    if (filterColaborador && !row.colaborador_nome.toLowerCase().includes(filterColaborador.toLowerCase())) {
      return false;
    }
    if (filterStatus === 'active' && !isVinculoActive(row)) return false;
    if (filterStatus === 'inactive' && isVinculoActive(row)) return false;
    return true;
  });

  const openCreate = () => {
    setEditingId(null);
    setForm({
      colaborador_id: '',
      horario_id: '',
      escala_id: '',
      data_inicio: new Date().toISOString().slice(0, 10),
      data_fim: '',
      ativo: true,
    });
    setModalOpen(true);
  };

  const openEdit = (row: VinculoRow) => {
    setEditingId(row.id);
    setForm({
      colaborador_id: row.colaborador_id,
      horario_id: row.horario_id || '',
      escala_id: row.escala_id || '',
      data_inicio: row.data_inicio,
      data_fim: row.data_fim || '',
      ativo: row.ativo,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    if (!form.colaborador_id) {
      setMessage({ type: 'error', text: 'Selecione um colaborador.' });
      return;
    }
    if (!form.horario_id && !form.escala_id) {
      setMessage({ type: 'error', text: 'Selecione pelo menos um horário ou escala.' });
      return;
    }
    if (!form.data_inicio) {
      setMessage({ type: 'error', text: 'Informe a data de início.' });
      return;
    }
    if (form.data_fim && form.data_fim < form.data_inicio) {
      setMessage({ type: 'error', text: 'Data de fim não pode ser anterior à data de início.' });
      return;
    }
    
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        colaborador_id: form.colaborador_id,
        horario_id: form.horario_id || null,
        escala_id: form.escala_id || null,
        data_inicio: form.data_inicio,
        data_fim: form.data_fim || null,
        ativo: form.ativo,
        updated_at: new Date().toISOString(),
      };
      
      if (editingId) {
        await db.update('colaborador_jornada', editingId, payload);
        setMessage({ type: 'success', text: 'Vínculo atualizado com sucesso.' });
      } else {
        await db.insert('colaborador_jornada', {
          id: crypto.randomUUID(),
          company_id: user.companyId,
          ...payload,
          created_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Vínculo criado com sucesso.' });
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este vínculo?')) return;
    try {
      await db.delete('colaborador_jornada', id);
      setMessage({ type: 'success', text: 'Vínculo excluído.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir.' });
    }
  };

  const handleEncerrar = async (row: VinculoRow) => {
    if (!confirm('Encerrar este vínculo hoje?')) return;
    try {
      await db.update('colaborador_jornada', row.id, {
        data_fim: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      });
      setMessage({ type: 'success', text: 'Vínculo encerrado.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao encerrar.' });
    }
  };

  const selectedColaborador = colaboradores.find((c) => c.id === form.colaborador_id);
  const filteredColaboradoresForPicker = colaboradorSearch.trim()
    ? colaboradores.filter((c) => 
        c.nome.toLowerCase().includes(colaboradorSearch.trim().toLowerCase()) ||
        c.email.toLowerCase().includes(colaboradorSearch.trim().toLowerCase())
      )
    : colaboradores;

  const inputClass = 'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white';

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-4 rounded-xl ${message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'} text-sm`}>
          {message.text}
        </div>
      )}
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Vinculação de Jornada" />
        <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700">
          <Plus className="w-5 h-5" /> Novo Vínculo
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-[200px] max-w-xs relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={filterColaborador}
            onChange={(e) => setFilterColaborador(e.target.value)}
            placeholder="Filtrar por colaborador..."
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filterStatus === 'all' ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('active')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filterStatus === 'active' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
          >
            Vigentes
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('inactive')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filterStatus === 'inactive' ? 'bg-slate-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}
          >
            Encerrados
          </button>
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
        {loadingData ? (
          <div className="p-12 text-center text-slate-500">Carregando...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Colaborador</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horário</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Escala</th>
                  <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Período</th>
                  <th className="text-center px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Status</th>
                  <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const isActive = isVinculoActive(row);
                  return (
                    <tr key={row.id} className={`border-b border-slate-100 dark:border-slate-800 ${!isActive ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                            <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          </div>
                          <span className="font-medium text-slate-900 dark:text-white">{row.colaborador_nome}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {row.horario_nome ? (
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4 text-slate-400" />
                            {row.horario_nome}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {row.escala_nome ? (
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            {row.escala_nome}
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        <div className="text-sm">
                          {formatDate(row.data_inicio)} → {row.data_fim ? formatDate(row.data_fim) : 'Em aberto'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                            <CheckCircle className="w-3 h-3" /> Vigente
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                            <XCircle className="w-3 h-3" /> Encerrado
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isActive && !row.data_fim && (
                          <button type="button" onClick={() => handleEncerrar(row)} className="p-2 text-amber-500 hover:text-amber-600 rounded-lg" title="Encerrar vínculo">
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button type="button" onClick={() => openEdit(row)} className="p-2 text-slate-500 hover:text-indigo-600 rounded-lg" title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => handleDelete(row.id)} className="p-2 text-slate-500 hover:text-red-600 rounded-lg" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loadingData && filteredRows.length === 0 && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">
            {rows.length === 0 ? 'Nenhum vínculo cadastrado. Clique em "Novo Vínculo" para começar.' : 'Nenhum vínculo encontrado com os filtros selecionados.'}
          </p>
        )}
      </div>

      {/* Modal Vínculo */}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar Vínculo' : 'Novo Vínculo de Jornada'}</h3>

            {/* Colaborador */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Colaborador *</label>
              {selectedColaborador ? (
                <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white">{selectedColaborador.nome}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{selectedColaborador.email}</div>
                  </div>
                  <button type="button" onClick={() => setForm({ ...form, colaborador_id: '' })} className="p-1 text-slate-500 hover:text-red-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setColaboradorPickerOpen(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Users className="w-4 h-4" />
                  Selecionar colaborador
                </button>
              )}
            </div>

            {/* Horário e Escala */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Horário</label>
                <select value={form.horario_id} onChange={(e) => setForm({ ...form, horario_id: e.target.value })} className={inputClass}>
                  <option value="">Nenhum</option>
                  {horarios.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Escala</label>
                <select value={form.escala_id} onChange={(e) => setForm({ ...form, escala_id: e.target.value })} className={inputClass}>
                  <option value="">Nenhuma</option>
                  {escalas.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>

            {/* Período */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data de Início *</label>
                <input type="date" value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data de Fim (opcional)</label>
                <input type="date" value={form.data_fim} onChange={(e) => setForm({ ...form, data_fim: e.target.value })} className={inputClass} />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Deixe em branco para vínculo sem data de término</p>
              </div>
            </div>

            {/* Ativo */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="vinculo-ativo"
                checked={form.ativo}
                onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="vinculo-ativo" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                Vínculo ativo
              </label>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Cancelar</button>
              <button type="button" onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* Picker de Colaborador */}
      {colaboradorPickerOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h4 className="font-semibold text-slate-900 dark:text-white">Selecionar Colaborador</h4>
              <button type="button" onClick={() => setColaboradorPickerOpen(false)} className="p-2 text-slate-500 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={colaboradorSearch}
                  onChange={(e) => setColaboradorSearch(e.target.value)}
                  placeholder="Buscar por nome ou email..."
                  className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                  autoFocus
                />
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto p-2">
              {filteredColaboradoresForPicker.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, colaborador_id: c.id });
                      setColaboradorPickerOpen(false);
                      setColaboradorSearch('');
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-white truncate">{c.nome}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{c.email}{c.cargo ? ` • ${c.cargo}` : ''}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {filteredColaboradoresForPicker.length === 0 && (
              <p className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Nenhum colaborador encontrado.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ColaboradorJornada;
