import React, { useEffect, useState } from 'react';
import { FileCheck, Plus, Pencil, Trash2 } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import RoleGuard from '../../components/auth/RoleGuard';

interface JustificativaRow {
  id: string;
  codigo: string;
  descricao: string;
  nome?: string | null;
  evento_id?: string | null;
  valor_dia?: number | null;
  automatico_valor_dia?: boolean;
  abonar_ajuste?: boolean;
  abonar_abono2?: boolean;
  abonar_abono3?: boolean;
  abonar_abono4?: boolean;
  lancar_como_faltas?: boolean;
  descontar_dsr?: boolean;
  nao_abonar_noturnas?: boolean;
  nao_calcular_dsr?: boolean;
  descontar_banco_horas?: boolean;
  descontar_provisao?: boolean;
  incluir_t_mais_nos_abonos?: boolean;
  company_id: string;
  created_at: string;
}

interface EventoOption {
  id: string;
  codigo: string;
  descricao: string;
}

const AdminJustificativas: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<JustificativaRow[]>([]);
  const [eventos, setEventos] = useState<EventoOption[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [nome, setNome] = useState('');
  const [eventoId, setEventoId] = useState('');
  const [valorDia, setValorDia] = useState('');
  const [automaticoValorDia, setAutomaticoValorDia] = useState(true);
  const [abonarAjuste, setAbonarAjuste] = useState(false);
  const [abonarAbono2, setAbonarAbono2] = useState(false);
  const [abonarAbono3, setAbonarAbono3] = useState(false);
  const [abonarAbono4, setAbonarAbono4] = useState(false);
  const [lancarComoFaltas, setLancarComoFaltas] = useState(false);
  const [descontarDsr, setDescontarDsr] = useState(false);
  const [naoAbonarNoturnas, setNaoAbonarNoturnas] = useState(false);
  const [naoCalcularDsr, setNaoCalcularDsr] = useState(false);
  const [descontarBancoHoras, setDescontarBancoHoras] = useState(false);
  const [descontarProvisao, setDescontarProvisao] = useState(false);
  const [incluirTMaisNosAbonos, setIncluirTMaisNosAbonos] = useState(false);
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
      const data = (await db.select('justificativas', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as any[];
      setRows((data ?? []).map((r: any) => ({
        id: r.id,
        codigo: r.codigo || '',
        descricao: r.descricao || '',
        nome: r.nome ?? null,
        evento_id: r.evento_id ?? null,
        valor_dia: r.valor_dia ?? null,
        automatico_valor_dia: r.automatico_valor_dia ?? true,
        abonar_ajuste: !!r.abonar_ajuste,
        abonar_abono2: !!r.abonar_abono2,
        abonar_abono3: !!r.abonar_abono3,
        abonar_abono4: !!r.abonar_abono4,
        lancar_como_faltas: !!r.lancar_como_faltas,
        descontar_dsr: !!r.descontar_dsr,
        nao_abonar_noturnas: !!r.nao_abonar_noturnas,
        nao_calcular_dsr: !!r.nao_calcular_dsr,
        descontar_banco_horas: !!r.descontar_banco_horas,
        descontar_provisao: !!r.descontar_provisao,
        incluir_t_mais_nos_abonos: !!r.incluir_t_mais_nos_abonos,
        company_id: r.company_id,
        created_at: r.created_at,
      })));
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: 'Erro ao carregar justificativas.' });
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      await load();
      if (!user?.companyId || !isSupabaseConfigured) return;
      try {
        const eventosRows = (await db.select('eventos_folha', [
          { column: 'company_id', operator: 'eq', value: user.companyId },
        ])) as any[];
        setEventos(
          (eventosRows ?? []).map((r: any) => ({
            id: r.id,
            codigo: r.codigo || '',
            descricao: r.descricao || '',
          })),
        );
      } catch (e) {
        console.error(e);
      }
    };
    run();
  }, [user?.companyId]);

  const openCreate = () => {
    setEditingId(null);
    setCodigo('');
    setDescricao('');
    setNome('');
    setEventoId('');
    setValorDia('');
    setAutomaticoValorDia(true);
    setAbonarAjuste(false);
    setAbonarAbono2(false);
    setAbonarAbono3(false);
    setAbonarAbono4(false);
    setLancarComoFaltas(false);
    setDescontarDsr(false);
    setNaoAbonarNoturnas(false);
    setNaoCalcularDsr(false);
    setDescontarBancoHoras(false);
    setDescontarProvisao(false);
    setIncluirTMaisNosAbonos(false);
    setModalOpen(true);
    setMessage(null);
    setModalError(null);
  };

  const openEdit = (row: JustificativaRow) => {
    setEditingId(row.id);
    setCodigo(row.codigo);
    setDescricao(row.descricao);
    setNome(row.nome ?? '');
    setEventoId(row.evento_id ?? '');
    setValorDia(row.valor_dia != null ? String(row.valor_dia) : '');
    setAutomaticoValorDia(row.automatico_valor_dia ?? true);
    setAbonarAjuste(!!row.abonar_ajuste);
    setAbonarAbono2(!!row.abonar_abono2);
    setAbonarAbono3(!!row.abonar_abono3);
    setAbonarAbono4(!!row.abonar_abono4);
    setLancarComoFaltas(!!row.lancar_como_faltas);
    setDescontarDsr(!!row.descontar_dsr);
    setNaoAbonarNoturnas(!!row.nao_abonar_noturnas);
    setNaoCalcularDsr(!!row.nao_calcular_dsr);
    setDescontarBancoHoras(!!row.descontar_banco_horas);
    setDescontarProvisao(!!row.descontar_provisao);
    setIncluirTMaisNosAbonos(!!row.incluir_t_mais_nos_abonos);
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
    const nomeTrim = nome.trim();
    if (!codigoTrim || !descTrim) {
      setModalError('Informe código e descrição.');
      return;
    }
    const valorDiaNum =
      valorDia.trim() === ''
        ? null
        : Number.parseFloat(valorDia.replace(',', '.')) || null;
    setSaving(true);
    setModalError(null);
    setMessage(null);
    try {
      const payload: any = {
        codigo: codigoTrim,
        descricao: descTrim,
        nome: nomeTrim || null,
        evento_id: eventoId || null,
        valor_dia: valorDiaNum,
        automatico_valor_dia: automaticoValorDia,
        abonar_ajuste: abonarAjuste,
        abonar_abono2: abonarAbono2,
        abonar_abono3: abonarAbono3,
        abonar_abono4: abonarAbono4,
        lancar_como_faltas: lancarComoFaltas,
        descontar_dsr: descontarDsr,
        nao_abonar_noturnas: naoAbonarNoturnas,
        nao_calcular_dsr: naoCalcularDsr,
        descontar_banco_horas: descontarBancoHoras,
        descontar_provisao: descontarProvisao,
        incluir_t_mais_nos_abonos: incluirTMaisNosAbonos,
      };
      if (editingId) {
        await db.update('justificativas', editingId, payload);
        setMessage({ type: 'success', text: 'Justificativa atualizada.' });
      } else {
        await db.insert('justificativas', {
          id: crypto.randomUUID(),
          company_id: user.companyId,
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setMessage({ type: 'success', text: 'Justificativa cadastrada.' });
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
    if (!confirm('Excluir esta justificativa?')) return;
    try {
      await db.delete('justificativas', id);
      setMessage({ type: 'success', text: 'Justificativa excluída.' });
      load();
    } catch (e: any) {
      setMessage({ type: 'error', text: (e as Error)?.message || 'Erro ao excluir.' });
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
            title="Justificativas"
            subtitle="Cadastro de justificativas para lançamento no Cartão Ponto e Ajustes Parciais."
            icon={<FileCheck size={24} />}
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
                    <th className="text-right px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">{row.codigo}</td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{row.descricao}</td>
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
                <p className="p-8 text-center text-slate-500 dark:text-slate-400">Nenhuma justificativa. Clique em Incluir para cadastrar.</p>
              )}
            </>
          )}
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !saving && setModalOpen(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{editingId ? 'Editar justificativa' : 'Nova justificativa'}</h3>
              {modalError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">{modalError}</div>
              )}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Dados de identificação</label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Código</label>
                    <input
                      type="text"
                      value={codigo}
                      onChange={(e) => { setCodigo(e.target.value); setModalError(null); }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      placeholder="Ex: FALTA"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nome (até ~7 caracteres)</label>
                    <input
                      type="text"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      maxLength={12}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      placeholder="Ex: FALTAS"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Evento</label>
                    <select
                      value={eventoId}
                      onChange={(e) => setEventoId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      <option value="">(opcional) Vincular evento...</option>
                      {eventos.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.codigo} - {ev.descricao}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Descrição</label>
                <input
                  type="text"
                  value={descricao}
                  onChange={(e) => { setDescricao(e.target.value); setModalError(null); }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Ex: Falta justificada, Férias, Atestado"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor Dia</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={valorDia}
                    onChange={(e) => setValorDia(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    placeholder="Ex: 08:00 ou 8,0"
                  />
                </div>
                <label className="flex items-center gap-2 mt-6 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={automaticoValorDia}
                    onChange={(e) => setAutomaticoValorDia(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    Valor Dia automático pela carga horária
                  </span>
                </label>
              </div>
              <hr className="border-slate-200 dark:border-slate-800" />
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
                  Abonar automaticamente
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={abonarAjuste} onChange={(e) => setAbonarAjuste(e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Lançar em Ajuste</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={abonarAbono2} onChange={(e) => setAbonarAbono2(e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Lançar em Abono 2</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={abonarAbono3} onChange={(e) => setAbonarAbono3(e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Lançar em Abono 3</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={abonarAbono4} onChange={(e) => setAbonarAbono4(e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Lançar em Abono 4</span>
                  </label>
                </div>
              </div>
              <hr className="border-slate-200 dark:border-slate-800" />
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
                  Outras opções
                </label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={lancarComoFaltas} onChange={(e) => setLancarComoFaltas(e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Lançar como horas faltas</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={descontarDsr} onChange={(e) => setDescontarDsr(e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Descontar DSR sem contabilizar como falta</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={naoAbonarNoturnas} onChange={(e) => setNaoAbonarNoturnas(e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Não abonar horas noturnas</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={naoCalcularDsr} onChange={(e) => setNaoCalcularDsr(e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Não calcular DSR</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={descontarBancoHoras} onChange={(e) => setDescontarBancoHoras(e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Descontar horas do banco de horas</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={descontarProvisao} onChange={(e) => setDescontarProvisao(e.target.checked)} className="rounded border-slate-300" />
                    <span className="text-sm text-slate-700 dark:text-slate-300">Descontar horas em período de provisão</span>
                  </label>
                </div>
              </div>
              <hr className="border-slate-200 dark:border-slate-800" />
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">
                  Comportamento de Abonos com T+
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={incluirTMaisNosAbonos}
                    onChange={(e) => setIncluirTMaisNosAbonos(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    Incluir valores positivos de T+ nas colunas de abono
                  </span>
                </label>
              </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Cancelar</button>
                <button type="button" onClick={(e) => handleSave(e)} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Salvando...' : 'Concluir'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
};

export default AdminJustificativas;
