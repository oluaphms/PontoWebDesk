import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import {
  CalendarClock,
  Plus,
  Pencil,
  Trash2,
  Printer,
  Copy,
  Filter,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

type EventoFolha = { id: string; codigo: string; descricao: string; unitario_padrao?: number | null };
type Employee = { id: string; nome: string; numero_folha?: string; employee_config?: { assinatura_digital?: string } };
type LancamentoRow = {
  id: string;
  user_id: string;
  company_id: string;
  evento_id: string;
  data: string;
  observacao: string | null;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  created_at: string;
  // joins
  user_nome?: string;
  evento_codigo?: string;
  evento_descricao?: string;
};

const formatDateBr = (d: string) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};

const formatMoney = (v: number) =>
  typeof v === 'number' && !Number.isNaN(v)
    ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0,00';

const AdminLancamentoEventos: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [eventos, setEventos] = useState<EventoFolha[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoRow[]>([]);
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('');
  const [filterEventoId, setFilterEventoId] = useState<string>('');
  const [loadingData, setLoadingData] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [form, setForm] = useState({
    user_id: '',
    data: '',
    evento_id: '',
    observacao: '',
    quantidade: '1',
    valor_unitario: '',
    incluir_para_todos: false,
  });
  const [selectedLancamentoId, setSelectedLancamentoId] = useState<string | null>(null);
  const [copyForm, setCopyForm] = useState({
    vezes: '1',
    intervalo_dias: '0',
    incluir_numero_obs: false,
    forcar_mesmo_dia: false,
  });

  const loadEmployees = useCallback(async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    try {
      const rows = (await db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as any[];
      setEmployees(
        (rows ?? []).map((u: any) => ({
          id: u.id,
          nome: u.nome || u.email || '',
          numero_folha: u.numero_folha,
          employee_config: u.employee_config ?? {},
        }))
      );
    } catch (e) {
      console.error(e);
    }
  }, [user?.companyId]);

  const loadEventos = useCallback(async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    try {
      const rows = (await db.select('eventos_folha', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as any[];
      setEventos((rows ?? []).map((r: any) => ({
        id: r.id,
        codigo: r.codigo || '',
        descricao: r.descricao || '',
        unitario_padrao: r.unitario_padrao ?? null,
      })));
    } catch (e) {
      console.error(e);
    }
  }, [user?.companyId]);

  const loadLancamentos = useCallback(async () => {
    if (!user?.companyId || !isSupabaseConfigured) {
      setLancamentos([]);
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    try {
      const filters: { column: string; operator: string; value: any }[] = [
        { column: 'company_id', operator: 'eq', value: user.companyId },
        { column: 'data', operator: 'gte', value: periodStart },
        { column: 'data', operator: 'lte', value: periodEnd },
      ];
      const rows = (await db.select('lancamento_eventos', filters)) as any[];
      const userIds = [...new Set((rows ?? []).map((r: any) => r.user_id))];
      const eventoIds = [...new Set((rows ?? []).map((r: any) => r.evento_id))];
      const userMap = new Map<string, string>();
      const eventoMap = new Map<string, { codigo: string; descricao: string }>();
      if (userIds.length) {
        const usersData = (await db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as any[];
        (usersData ?? []).forEach((u: any) => userMap.set(u.id, u.nome || u.email || ''));
      }
      if (eventoIds.length) {
        const eventosData = (await db.select('eventos_folha', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as any[];
        (eventosData ?? []).forEach((e: any) => eventoMap.set(e.id, { codigo: e.codigo || '', descricao: e.descricao || '' }));
      }
      setLancamentos((rows ?? []).map((r: any) => ({
        ...r,
        user_nome: userMap.get(r.user_id) ?? '',
        evento_codigo: eventoMap.get(r.evento_id)?.codigo ?? '',
        evento_descricao: eventoMap.get(r.evento_id)?.descricao ?? '',
      })));
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: 'Erro ao carregar lançamentos.' });
    } finally {
      setLoadingData(false);
    }
  }, [user?.companyId, periodStart, periodEnd]);

  useEffect(() => {
    loadEmployees();
    loadEventos();
  }, [loadEmployees, loadEventos]);

  useEffect(() => {
    loadLancamentos();
  }, [loadLancamentos]);

  const filteredLancamentos = useMemo(() => {
    let list = lancamentos;
    if (filterEmployeeId) list = list.filter((l) => l.user_id === filterEmployeeId);
    if (filterEventoId) list = list.filter((l) => l.evento_id === filterEventoId);
    return list;
  }, [lancamentos, filterEmployeeId, filterEventoId]);

  const resumoPorEvento = useMemo(() => {
    const map = new Map<string, { codigo: string; descricao: string; quantidade: number; valorTotal: number }>();
    filteredLancamentos.forEach((l) => {
      const key = l.evento_id;
      const cur = map.get(key) ?? {
        codigo: l.evento_codigo ?? '',
        descricao: l.evento_descricao ?? '',
        quantidade: 0,
        valorTotal: 0,
      };
      cur.quantidade += Number(l.quantidade) || 0;
      cur.valorTotal += Number(l.valor_total) || 0;
      map.set(key, cur);
    });
    return Array.from(map.entries()).map(([id, v]) => ({ evento_id: id, ...v }));
  }, [filteredLancamentos]);

  const valorTotalCalculado = useMemo(() => {
    const q = parseFloat((form.quantidade || '0').replace(',', '.')) || 0;
    const u = parseFloat((form.valor_unitario || '0').replace(',', '.')) || 0;
    return q * u;
  }, [form.quantidade, form.valor_unitario]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      user_id: '',
      data: new Date().toISOString().slice(0, 10),
      evento_id: '',
      observacao: '',
      quantidade: '1',
      valor_unitario: '',
      incluir_para_todos: false,
    });
    setModalOpen(true);
    setModalError(null);
  };

  const openEdit = (row: LancamentoRow) => {
    setEditingId(row.id);
    setForm({
      user_id: row.user_id,
      data: row.data?.slice(0, 10) ?? '',
      evento_id: row.evento_id,
      observacao: row.observacao ?? '',
      quantidade: String(row.quantidade ?? 1),
      valor_unitario: String(row.valor_unitario ?? ''),
      incluir_para_todos: false,
    });
    setModalOpen(true);
    setModalError(null);
  };

  const handleSave = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (!isSupabaseConfigured || !user?.companyId) {
      setModalError('Configuração ou empresa não identificada.');
      return;
    }
    const userId = form.user_id.trim();
    const data = form.data?.slice(0, 10);
    const eventoId = form.evento_id;
    const quantidade = parseFloat((form.quantidade || '1').replace(',', '.')) || 1;
    const valorUnitario = parseFloat((form.valor_unitario || '0').replace(',', '.')) || 0;
    const valorTotal = quantidade * valorUnitario;

    if (!data) {
      setModalError('Informe a data do evento.');
      return;
    }
    if (!eventoId) {
      setModalError('Selecione o evento.');
      return;
    }

    setSaving(true);
    setModalError(null);
    try {
      const payload = {
        data,
        evento_id: eventoId,
        observacao: form.observacao.trim() || null,
        quantidade,
        valor_unitario: valorUnitario,
        valor_total: valorTotal,
      };

      if (form.incluir_para_todos && !editingId) {
        const targetUsers = filterEmployeeId ? employees.filter((e) => e.id === filterEmployeeId) : employees;
        const listToUse = targetUsers.length ? targetUsers : employees;
        if (listToUse.length === 0) {
          setModalError('Nenhum funcionário na lista para incluir.');
          setSaving(false);
          return;
        }
        for (const emp of listToUse) {
          await db.insert('lancamento_eventos', {
            id: crypto.randomUUID(),
            user_id: emp.id,
            company_id: user.companyId,
            ...payload,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
        setMessage({ type: 'success', text: `Evento lançado para ${listToUse.length} funcionário(s).` });
      } else {
        if (!userId && !editingId) {
          setModalError('Selecione o funcionário ou marque "Incluir para todos da lista".');
          setSaving(false);
          return;
        }
        if (editingId) {
          await db.update('lancamento_eventos', editingId, payload);
          setMessage({ type: 'success', text: 'Lançamento atualizado.' });
        } else {
          await db.insert('lancamento_eventos', {
            id: crypto.randomUUID(),
            user_id: userId,
            company_id: user.companyId,
            ...payload,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          setMessage({ type: 'success', text: 'Evento incluído.' });
        }
      }
      setModalOpen(false);
      loadLancamentos();
    } catch (err: any) {
      setModalError(err?.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este lançamento?')) return;
    try {
      await db.delete('lancamento_eventos', id);
      setMessage({ type: 'success', text: 'Lançamento excluído.' });
      setSelectedLancamentoId(null);
      loadLancamentos();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao excluir.' });
    }
  };

  const openCopyModal = (lancamentoId: string) => {
    setSelectedLancamentoId(lancamentoId);
    setCopyForm({ vezes: '1', intervalo_dias: '0', incluir_numero_obs: false, forcar_mesmo_dia: false });
    setCopyModalOpen(true);
  };

  const handleCopy = async () => {
    if (!selectedLancamentoId || !user?.companyId || !isSupabaseConfigured) return;
    const lanc = lancamentos.find((l) => l.id === selectedLancamentoId);
    if (!lanc) return;
    const vezes = Math.max(1, parseInt(copyForm.vezes, 10) || 1);
    const intervalo = Math.max(0, parseInt(copyForm.intervalo_dias, 10) || 0);
    setSaving(true);
    try {
      let data = new Date(lanc.data);
      for (let i = 0; i < vezes; i++) {
        const dataStr = data.toISOString().slice(0, 10);
        const obs = copyForm.incluir_numero_obs ? `${lanc.observacao || ''} (${i + 1}/${vezes})`.trim() : (lanc.observacao || null);
        await db.insert('lancamento_eventos', {
          id: crypto.randomUUID(),
          user_id: lanc.user_id,
          company_id: user.companyId,
          evento_id: lanc.evento_id,
          data: copyForm.forcar_mesmo_dia ? lanc.data : dataStr,
          observacao: obs,
          quantidade: lanc.quantidade,
          valor_unitario: lanc.valor_unitario,
          valor_total: lanc.valor_total,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        if (!copyForm.forcar_mesmo_dia) data.setDate(data.getDate() + intervalo + 1);
      }
      setMessage({ type: 'success', text: `Evento copiado ${vezes} vez(es).` });
      setCopyModalOpen(false);
      loadLancamentos();
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao copiar.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = (tipo: 'detalhado' | 'geral') => {
    const printContent = document.getElementById(tipo === 'detalhado' ? 'print-area-detalhado' : 'print-area-geral');
    if (!printContent) return;
    const w = window.open('', '_blank');
    if (!w) {
      setMessage({ type: 'error', text: 'Permita pop-ups para imprimir.' });
      return;
    }
    w.document.write(`
      <!DOCTYPE html><html><head><title>Lançamento de Eventos - ${tipo}</title>
      <style>body{font-family:sans-serif;padding:16px;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #333;padding:6px;text-align:left;} th{background:#eee;}</style>
      </head><body>${printContent.innerHTML}</body></html>`);
    w.document.close();
    w.print();
    w.close();
  };

  const onSelectEvento = (eventoId: string) => {
    const ev = eventos.find((e) => e.id === eventoId);
    setForm((f) => ({
      ...f,
      evento_id: eventoId,
      valor_unitario: ev?.unitario_padrao != null ? String(ev.unitario_padrao) : f.valor_unitario,
    }));
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <RoleGuard user={user} allowedRoles={['admin', 'hr']}>
      <div className="space-y-4">
        <PageHeader
          title="Lançamento de Eventos"
          subtitle="Lance eventos para funcionários (vales, ordens, adiantamentos). Selecione o período e use os filtros. Para cadastrar eventos: Cadastro &gt; Eventos."
          icon={<CalendarClock size={24} />}
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

        {/* Período e Filtros */}
        <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (início)</label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (fim)</label>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
              <Filter className="w-3 h-3 inline mr-1" /> Filtros
            </label>
            <div className="flex gap-2 flex-wrap">
              <select
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[180px]"
              >
                <option value="">Todos os funcionários</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.nome}</option>
                ))}
              </select>
              <select
                value={filterEventoId}
                onChange={(e) => setFilterEventoId(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[160px]"
              >
                <option value="">Todos os eventos</option>
                {eventos.map((e) => (
                  <option key={e.id} value={e.id}>{e.codigo} - {e.descricao}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={() => handlePrint('geral')}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Printer className="w-4 h-4" /> Imprimir (geral)
            </button>
            <button
              type="button"
              onClick={() => handlePrint('detalhado')}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Printer className="w-4 h-4" /> Imprimir (detalhado por funcionário)
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Lista de lançamentos */}
          <div className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            <div className="p-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2">
              <span className="font-bold text-slate-700 dark:text-slate-300">Lançamentos no período</span>
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4" /> Incluir
              </button>
            </div>
            {loadingData ? (
              <div className="p-12 text-center text-slate-500">Carregando...</div>
            ) : (
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-bold text-slate-500 dark:text-slate-400">Data</th>
                      <th className="text-left px-3 py-2 font-bold text-slate-500 dark:text-slate-400">Funcionário</th>
                      <th className="text-left px-3 py-2 font-bold text-slate-500 dark:text-slate-400">Evento</th>
                      <th className="text-right px-3 py-2 font-bold text-slate-500 dark:text-slate-400">Qtd</th>
                      <th className="text-right px-3 py-2 font-bold text-slate-500 dark:text-slate-400">Valor total</th>
                      <th className="text-right px-3 py-2 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLancamentos.map((row) => (
                      <tr
                        key={row.id}
                        className={`border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 ${selectedLancamentoId === row.id ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : ''}`}
                      >
                        <td className="px-3 py-2 whitespace-nowrap">{formatDateBr(row.data)}</td>
                        <td className="px-3 py-2">{row.user_nome}</td>
                        <td className="px-3 py-2">{row.evento_codigo} - {row.evento_descricao}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.quantidade}</td>
                        <td className="px-3 py-2 text-right tabular-nums">R$ {formatMoney(row.valor_total)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button type="button" onClick={() => openEdit(row)} className="p-1.5 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded" title="Alterar">
                            <Pencil className="w-4 h-4 inline" />
                          </button>
                          <button type="button" onClick={() => openCopyModal(row.id)} className="p-1.5 text-slate-500 hover:text-blue-600 rounded" title="Copiar evento">
                            <Copy className="w-4 h-4 inline" />
                          </button>
                          <button type="button" onClick={() => handleDelete(row.id)} className="p-1.5 text-slate-500 hover:text-red-600 rounded" title="Excluir">
                            <Trash2 className="w-4 h-4 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loadingData && filteredLancamentos.length === 0 && (
                  <p className="p-8 text-center text-slate-500">Nenhum lançamento no período. Clique em Incluir para lançar eventos.</p>
                )}
              </div>
            )}
          </div>

          {/* Resumo por evento */}
          <div className="w-full lg:w-80 shrink-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
            <div className="p-3 border-b border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-300">
              Quantidade por evento
            </div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-bold text-slate-500 dark:text-slate-400">Evento</th>
                    <th className="text-right px-3 py-2 font-bold text-slate-500 dark:text-slate-400">Qtd</th>
                    <th className="text-right px-3 py-2 font-bold text-slate-500 dark:text-slate-400">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {resumoPorEvento.map((r) => (
                    <tr key={r.evento_id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2">{r.codigo} - {r.descricao}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.quantidade}</td>
                      <td className="px-3 py-2 text-right tabular-nums">R$ {formatMoney(r.valorTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {resumoPorEvento.length === 0 && !loadingData && (
                <p className="p-4 text-center text-slate-500 text-xs">Nenhum evento no período.</p>
              )}
            </div>
          </div>
        </div>

        {/* Painel Incluir / formulário (canto inferior direito conceitual: botão Incluir abre modal) */}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          OBS.: Caso o funcionário tenha cadastrada uma Assinatura Digital (Cadastro &gt; Funcionários), ela poderá ser solicitada no lançamento do evento.
        </p>

        {/* Modal Incluir / Editar */}
        {modalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !saving && setModalOpen(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Alterar lançamento' : 'Incluir evento'}</h3>
              {modalError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">{modalError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Funcionário</label>
                <select
                  value={form.user_id}
                  onChange={(e) => setForm({ ...form, user_id: e.target.value })}
                  disabled={!!editingId || form.incluir_para_todos}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Selecione...</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.nome}</option>
                  ))}
                </select>
              </div>
              {!editingId && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.incluir_para_todos} onChange={(e) => setForm({ ...form, incluir_para_todos: e.target.checked })} className="rounded border-slate-300" />
                  <span className="text-sm text-slate-700 dark:text-slate-300">Incluir para todos da lista de nomes</span>
                </label>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Data</label>
                <input
                  type="date"
                  value={form.data}
                  onChange={(e) => setForm({ ...form, data: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Evento</label>
                <select
                  value={form.evento_id}
                  onChange={(e) => onSelectEvento(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Selecione... (cadastro em Cadastro &gt; Eventos)</option>
                  {eventos.map((e) => (
                    <option key={e.id} value={e.id}>{e.codigo} - {e.descricao}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Observação</label>
                <input
                  type="text"
                  value={form.observacao}
                  onChange={(e) => setForm({ ...form, observacao: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Observação sobre o lançamento"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Quantidade</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.quantidade}
                    onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor unitário</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.valor_unitario}
                    onChange={(e) => setForm({ ...form, valor_unitario: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor total</label>
                  <div className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300">
                    R$ {formatMoney(valorTotalCalculado)}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">
                  Cancelar
                </button>
                <button type="button" onClick={(e) => handleSave(e)} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? 'Salvando...' : editingId ? 'Salvar' : 'Incluir'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Copiar Evento */}
        {copyModalOpen && selectedLancamentoId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !saving && setCopyModalOpen(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Copiar evento</h3>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Copiar evento ... vezes</label>
                <input
                  type="number"
                  min={1}
                  value={copyForm.vezes}
                  onChange={(e) => setCopyForm({ ...copyForm, vezes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Intervalo ... dias</label>
                <input
                  type="number"
                  min={0}
                  value={copyForm.intervalo_dias}
                  onChange={(e) => setCopyForm({ ...copyForm, intervalo_dias: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={copyForm.incluir_numero_obs} onChange={(e) => setCopyForm({ ...copyForm, incluir_numero_obs: e.target.checked })} className="rounded border-slate-300" />
                <span className="text-sm text-slate-700 dark:text-slate-300">Incluir numeração na observação</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={copyForm.forcar_mesmo_dia} onChange={(e) => setCopyForm({ ...copyForm, forcar_mesmo_dia: e.target.checked })} className="rounded border-slate-300" />
                <span className="text-sm text-slate-700 dark:text-slate-300">Forçar vencimento para o mesmo dia</span>
              </label>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setCopyModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Cancelar</button>
                <button type="button" onClick={handleCopy} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Copiando...' : 'Copiar'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Áreas para impressão (ocultas na tela, usadas no print) */}
        <div id="print-area-detalhado" className="hidden print:block">
          <h2>Lançamento de Eventos - Detalhado por funcionário</h2>
          <p>Período: {formatDateBr(periodStart)} a {formatDateBr(periodEnd)}</p>
          {[...new Set(filteredLancamentos.map((l) => l.user_id))].map((uid) => {
            const nome = filteredLancamentos.find((l) => l.user_id === uid)?.user_nome ?? '';
            const itens = filteredLancamentos.filter((l) => l.user_id === uid);
            return (
              <div key={uid} style={{ marginTop: 16, pageBreakInside: 'avoid' }}>
                <h3>{nome}</h3>
                <table style={{ width: '100%', marginTop: 8 }}>
                  <thead>
                    <tr><th>Data</th><th>Evento</th><th>Obs</th><th>Qtd</th><th>Valor total</th></tr>
                  </thead>
                  <tbody>
                    {itens.map((l) => (
                      <tr key={l.id}>
                        <td>{formatDateBr(l.data)}</td>
                        <td>{l.evento_codigo} - {l.evento_descricao}</td>
                        <td>{l.observacao ?? ''}</td>
                        <td>{l.quantidade}</td>
                        <td>R$ {formatMoney(l.valor_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        <div id="print-area-geral" className="hidden print:block">
          <h2>Lançamento de Eventos - Relatório geral</h2>
          <p>Período: {formatDateBr(periodStart)} a {formatDateBr(periodEnd)}</p>
          <table style={{ width: '100%', marginTop: 16 }}>
            <thead>
              <tr><th>Data</th><th>Funcionário</th><th>Evento</th><th>Obs</th><th>Qtd</th><th>Valor total</th></tr>
            </thead>
            <tbody>
              {filteredLancamentos.map((l) => (
                <tr key={l.id}>
                  <td>{formatDateBr(l.data)}</td>
                  <td>{l.user_nome}</td>
                  <td>{l.evento_codigo} - {l.evento_descricao}</td>
                  <td>{l.observacao ?? ''}</td>
                  <td>{l.quantidade}</td>
                  <td>R$ {formatMoney(l.valor_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </RoleGuard>
  );
};

export default AdminLancamentoEventos;
