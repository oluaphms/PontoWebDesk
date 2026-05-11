import React, { useEffect, useState } from 'react';
import type { ExtrasConfig, ExtrasPainelFaixas, ExtrasFaixaHoraColuna, ExtrasDivisoesNoturnas } from '../../../types';
import { createDefaultExtras, mergeExtras, createDefaultPainelFaixas } from '../../../types';

const inp = 'w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm';

type TabId =
  | 'gerais'
  | 'dias_uteis'
  | 'dia_especial'
  | 'noturnas_uteis'
  | 'banco'
  | 'intervalo_uteis'
  | 'divisoes_noturnas';

const TABS: { id: TabId; label: string }[] = [
  { id: 'gerais', label: 'Gerais' },
  { id: 'dias_uteis', label: 'Dias Úteis' },
  { id: 'dia_especial', label: 'Dia Especial' },
  { id: 'noturnas_uteis', label: 'Noturnas - Dias Úteis' },
  { id: 'banco', label: 'Banco de Horas' },
  { id: 'intervalo_uteis', label: 'Intervalo - Dias Úteis' },
  { id: 'divisoes_noturnas', label: 'Divisões Noturnas' },
];

const ACUMULAR_OPCOES: { value: ExtrasConfig['acumular']; label: string }[] = [
  { value: 'independentes', label: 'Independentes' },
  { value: 'uteis_sabados', label: 'Úteis + Sábados' },
  { value: 'uteis_sabados_domingos', label: 'Úteis + Sábados + Domingos' },
  { value: 'uteis_sabados_domingos_feriados', label: 'Úteis + Sábados + Domingos + Feriados' },
  { value: 'uteis_sab_dom_fer_folga', label: 'Úteis + Sáb + Dom. + Fer. + Folga' },
  { value: 'sabados_domingos', label: 'Sábados + Domingos' },
  { value: 'sabados_domingos_feriados', label: 'Sábados + Domingos + Feriados' },
  { value: 'domingos_feriados', label: 'Domingos + Feriados' },
  { value: 'uteis_sabados_e_domingos_feriados', label: '(Úteis + Sábados) e (Domingos + Feriados)' },
  { value: 'uteis_domingos_e_sabados_feriados', label: '(Úteis + Domingos) e (Sábados + Feriados)' },
];

function newFaixaRow(): ExtrasFaixaHoraColuna {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `fx-${Date.now()}`,
    acimaDe: 0,
    coluna: '',
  };
}

function ensurePainel(p?: ExtrasPainelFaixas): ExtrasPainelFaixas {
  if (p?.faixas?.length) return p;
  return { ...createDefaultPainelFaixas(), faixas: [newFaixaRow()] };
}

function FaixasTable({
  painel,
  onChange,
}: {
  painel: ExtrasPainelFaixas;
  onChange: (next: ExtrasPainelFaixas) => void;
}) {
  const p = ensurePainel(painel);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-800">
              <th className="px-2 py-2 text-left w-24" />
              <th className="px-2 py-2 text-left">Horas</th>
              <th className="px-2 py-2 text-left">Coluna</th>
            </tr>
          </thead>
          <tbody>
            {p.faixas.map((row, idx) => (
              <tr key={row.id} className="border-t border-slate-200 dark:border-slate-700">
                <td className="px-2 py-1 text-slate-600 dark:text-slate-400">{idx === 0 ? 'Acima de' : ''}</td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className={inp}
                    value={row.acimaDe}
                    onChange={(e) => {
                      const n = [...p.faixas];
                      n[idx] = { ...row, acimaDe: Number(e.target.value) || 0 };
                      onChange({ ...p, faixas: n });
                    }}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="text"
                    className={inp}
                    value={row.coluna}
                    onChange={(e) => {
                      const n = [...p.faixas];
                      n[idx] = { ...row, coluna: e.target.value };
                      onChange({ ...p, faixas: n });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface ConfiguracaoHorasExtrasModalProps {
  open: boolean;
  onClose: () => void;
  value: ExtrasConfig;
  onApply: (next: ExtrasConfig) => void;
  outrosHorarios: { id: string; label: string }[];
  getExtrasFromHorario: (horarioId: string | null) => ExtrasConfig | undefined;
}

const ConfiguracaoHorasExtrasModal: React.FC<ConfiguracaoHorasExtrasModalProps> = ({
  open,
  onClose,
  value,
  onApply,
  outrosHorarios,
  getExtrasFromHorario,
}) => {
  const [tab, setTab] = useState<TabId>('gerais');
  const [draft, setDraft] = useState<ExtrasConfig>(value);
  const [copiarId, setCopiarId] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(mergeExtras(createDefaultExtras(), value));
      setCopiarId('');
      setTab('gerais');
    }
  }, [open, value]);

  const set = (partial: Partial<ExtrasConfig>) => setDraft((d) => ({ ...d, ...partial }));
  const div = (partial: Partial<ExtrasDivisoesNoturnas>) =>
    setDraft((d) => ({ ...d, divisoesNoturnas: { ...d.divisoesNoturnas, ...partial } }));

  const pu = (k: 'diasUteis' | 'noturnasDiasUteis' | 'intervaloDiasUteis', next: ExtrasPainelFaixas) =>
    setDraft((d) => ({ ...d, [k]: next }));

  if (!open) return null;

  const d = draft;
  const dn = d.divisoesNoturnas ?? {};
  const sepMeia = dn.separarSomatoriaAposMeiaNoite ?? false;
  const divFolga = dn.dividirJornadasFolgaMeiaNoite ?? false;

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div
        className="bg-slate-100 dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-300 dark:border-slate-700 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800 shrink-0">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Configuração de Horas Extras</h2>
        </div>

        <div className="flex flex-1 min-h-0">
          <nav className="w-52 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 overflow-y-auto p-2 space-y-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id ? 'bg-blue-700 text-white shadow-sm' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto p-4 min-w-0 text-sm">
            {tab === 'gerais' && (
              <div className="space-y-4 rounded-lg border border-slate-300 dark:border-slate-600 p-4 bg-white dark:bg-slate-950/30">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Acumular</label>
                  <select className={inp} value={d.acumular} onChange={(e) => set({ acumular: e.target.value as ExtrasConfig['acumular'] })}>
                    {ACUMULAR_OPCOES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={d.multiplicarExtrasPercentual ?? false} onChange={(e) => set({ multiplicarExtrasPercentual: e.target.checked })} />
                  Multiplicar extras pelo percentual
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={d.arredondarAtivo ?? false} onChange={(e) => set({ arredondarAtivo: e.target.checked })} />
                    Arredondar horas extras
                  </label>
                  <div className={`ml-6 space-y-2 ${!(d.arredondarAtivo ?? false) ? 'opacity-45 pointer-events-none' : ''}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>Razão</span>
                      <input
                        type="number"
                        min={0}
                        className={`${inp} w-24`}
                        value={d.arredondarRazaoMinutos ?? ''}
                        onChange={(e) => set({ arredondarRazaoMinutos: e.target.value ? Number(e.target.value) : undefined })}
                      />
                      <span>minutos</span>
                    </div>
                    <select className={inp} value={d.arredondarModo ?? ''} onChange={(e) => set({ arredondarModo: e.target.value })}>
                      <option value="">(modo)</option>
                      <option value="5">5 min</option>
                      <option value="10">10 min</option>
                      <option value="15">15 min</option>
                    </select>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={d.naoArredondarHorasNoturnas ?? false} onChange={(e) => set({ naoArredondarHorasNoturnas: e.target.checked })} />
                      Não arredondar horas noturnas
                    </label>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={d.descontarFaltasDasExtras ?? false} onChange={(e) => set({ descontarFaltasDasExtras: e.target.checked })} />
                    Descontar FALTAS das EXTRAS
                  </label>
                  <select
                    className={`${inp} max-w-xs ${!(d.descontarFaltasDasExtras ?? false) ? 'opacity-45 pointer-events-none' : ''}`}
                    value={d.descontarFaltasModo ?? ''}
                    onChange={(e) => set({ descontarFaltasModo: e.target.value })}
                  >
                    <option value="">(prioridade)</option>
                    <option value="maior">Maior</option>
                    <option value="menor">Menor</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 flex-wrap">
                    <input type="checkbox" checked={d.interjornadasAtivo ?? false} onChange={(e) => set({ interjornadasAtivo: e.target.checked })} />
                    Interjornadas menor que
                    <input
                      type="time"
                      className={`${inp} w-32 inline`}
                      disabled={!(d.interjornadasAtivo ?? false)}
                      value={d.interjornadasHoras ?? ''}
                      onChange={(e) => set({ interjornadasHoras: e.target.value })}
                    />
                    horas
                  </label>
                  <label className={`flex items-center gap-2 ml-6 ${!(d.interjornadasAtivo ?? false) ? 'opacity-45 pointer-events-none' : ''}`}>
                    <input type="checkbox" checked={d.interjornadasColunaSeparada ?? false} onChange={(e) => set({ interjornadasColunaSeparada: e.target.checked })} />
                    Calcular em coluna separada
                  </label>
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={d.separarExtrasNoturnasNormais ?? false} onChange={(e) => set({ separarExtrasNoturnasNormais: e.target.checked })} />
                  Separar Extras Noturnas de Extras Normais
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={d.separarExtrasIntervalosNormais ?? false} onChange={(e) => set({ separarExtrasIntervalosNormais: e.target.checked })} />
                  Separar Extras Intervalos de Extras Normais
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={d.agruparExtrasMesmaPorcentagem ?? true} onChange={(e) => set({ agruparExtrasMesmaPorcentagem: e.target.checked })} />
                  Agrupar extras de mesma porcentagem
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={d.usarHorasSomenteGrupoExtras ?? false} onChange={(e) => set({ usarHorasSomenteGrupoExtras: e.target.checked })} />
                  Usar horas somente do Grupo de Extras
                </label>
              </div>
            )}

            {tab === 'dias_uteis' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1">Controle de horas</label>
                    <select
                      className={inp}
                      value={ensurePainel(d.diasUteis).controleHoras}
                      onChange={(e) =>
                        pu('diasUteis', {
                          ...ensurePainel(d.diasUteis),
                          controleHoras: e.target.value as ExtrasPainelFaixas['controleHoras'],
                        })
                      }
                    >
                      <option value="diario">Diário</option>
                      <option value="semanal">Semanal</option>
                      <option value="mensal">Mensal</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs mb-1">Número de faixas</label>
                    <input
                      type="number"
                      min={1}
                      className={inp}
                      value={ensurePainel(d.diasUteis).numeroFaixas}
                      onChange={(e) =>
                        pu('diasUteis', {
                          ...ensurePainel(d.diasUteis),
                          numeroFaixas: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                    />
                  </div>
                </div>
                <FaixasTable painel={ensurePainel(d.diasUteis)} onChange={(next) => pu('diasUteis', next)} />
              </div>
            )}

            {tab === 'dia_especial' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1">Controle de horas</label>
                    <select
                      className={inp}
                      value={(draft.diaEspecial ?? createDefaultPainelFaixas()).controleHoras}
                      onChange={(e) =>
                        setDraft((x) => ({
                          ...x,
                          diaEspecial: {
                            ...ensurePainel(x.diaEspecial),
                            controleHoras: e.target.value as ExtrasPainelFaixas['controleHoras'],
                          },
                        }))
                      }
                    >
                      <option value="diario">Diário</option>
                      <option value="semanal">Semanal</option>
                      <option value="mensal">Mensal</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs mb-1">Número de faixas</label>
                    <input
                      type="number"
                      min={1}
                      className={inp}
                      value={(draft.diaEspecial ?? createDefaultPainelFaixas()).numeroFaixas}
                      onChange={(e) =>
                        setDraft((x) => ({
                          ...x,
                          diaEspecial: {
                            ...ensurePainel(x.diaEspecial),
                            numeroFaixas: Math.max(1, Number(e.target.value) || 1),
                          },
                        }))
                      }
                    />
                  </div>
                </div>
                <FaixasTable
                  painel={ensurePainel(draft.diaEspecial)}
                  onChange={(next) => setDraft((x) => ({ ...x, diaEspecial: { ...next, usarEspecialPara: (x.diaEspecial as any)?.usarEspecialPara } }))}
                />
                <div>
                  <label className="block text-xs mb-1">Usar especial para</label>
                  <select
                    className={inp}
                    value={(draft.diaEspecial as any)?.usarEspecialPara ?? 'nao_usar'}
                    onChange={(e) =>
                      setDraft((x) => ({
                        ...x,
                        diaEspecial: { ...ensurePainel(x.diaEspecial), usarEspecialPara: e.target.value },
                      }))
                    }
                  >
                    <option value="nao_usar">&lt;Não Usar&gt;</option>
                    <option value="feriado">Feriado</option>
                    <option value="domingo">Domingo</option>
                  </select>
                </div>
              </div>
            )}

            {tab === 'noturnas_uteis' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1">Controle de horas</label>
                    <select
                      className={inp}
                      value={ensurePainel(d.noturnasDiasUteis).controleHoras}
                      onChange={(e) =>
                        pu('noturnasDiasUteis', {
                          ...ensurePainel(d.noturnasDiasUteis),
                          controleHoras: e.target.value as ExtrasPainelFaixas['controleHoras'],
                        })
                      }
                    >
                      <option value="diario">Diário</option>
                      <option value="semanal">Semanal</option>
                      <option value="mensal">Mensal</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs mb-1">Número de faixas</label>
                    <input
                      type="number"
                      min={1}
                      className={inp}
                      value={ensurePainel(d.noturnasDiasUteis).numeroFaixas}
                      onChange={(e) =>
                        pu('noturnasDiasUteis', {
                          ...ensurePainel(d.noturnasDiasUteis),
                          numeroFaixas: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                    />
                  </div>
                </div>
                <FaixasTable painel={ensurePainel(d.noturnasDiasUteis)} onChange={(next) => pu('noturnasDiasUteis', next)} />
              </div>
            )}

            {tab === 'banco' && (
              <div className="space-y-4 rounded-lg border border-slate-300 dark:border-slate-600 p-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={d.bancoHorasHabilitado ?? false} onChange={(e) => set({ bancoHorasHabilitado: e.target.checked })} />
                  Habilitar banco de horas
                </label>
                <div>
                  <label className="block text-xs mb-1">Tipo de horas</label>
                  <select
                    className={inp}
                    value={d.bancoHorasTipo ?? 'extras'}
                    onChange={(e) => set({ bancoHorasTipo: e.target.value as ExtrasConfig['bancoHorasTipo'] })}
                  >
                    <option value="extras">Extras</option>
                    <option value="faltas">Faltas</option>
                    <option value="atrasos">Atrasos</option>
                  </select>
                </div>
              </div>
            )}

            {tab === 'intervalo_uteis' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1">Controle de horas</label>
                    <select
                      className={inp}
                      value={ensurePainel(d.intervaloDiasUteis).controleHoras}
                      onChange={(e) =>
                        pu('intervaloDiasUteis', {
                          ...ensurePainel(d.intervaloDiasUteis),
                          controleHoras: e.target.value as ExtrasPainelFaixas['controleHoras'],
                        })
                      }
                    >
                      <option value="diario">Diário</option>
                      <option value="semanal">Semanal</option>
                      <option value="mensal">Mensal</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs mb-1">Número de faixas</label>
                    <input
                      type="number"
                      min={1}
                      className={inp}
                      value={ensurePainel(d.intervaloDiasUteis).numeroFaixas}
                      onChange={(e) =>
                        pu('intervaloDiasUteis', {
                          ...ensurePainel(d.intervaloDiasUteis),
                          numeroFaixas: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                    />
                  </div>
                </div>
                <FaixasTable painel={ensurePainel(d.intervaloDiasUteis)} onChange={(next) => pu('intervaloDiasUteis', next)} />
              </div>
            )}

            {tab === 'divisoes_noturnas' && (
              <div className="space-y-3 rounded-lg border border-slate-300 dark:border-slate-600 p-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={sepMeia} onChange={(e) => div({ separarSomatoriaAposMeiaNoite: e.target.checked })} />
                    Separar somatória de horas extras após a meia noite
                  </label>
                  <div className={`ml-6 space-y-1 ${!sepMeia ? 'opacity-45 pointer-events-none' : ''}`}>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={dn.naoDividirExtrasFeriados ?? false} onChange={(e) => div({ naoDividirExtrasFeriados: e.target.checked })} />
                      Não dividir extras em feriados
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={dn.naoDividirExtrasDomingos ?? false} onChange={(e) => div({ naoDividirExtrasDomingos: e.target.checked })} />
                      Não dividir extras em domingos
                    </label>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={divFolga} onChange={(e) => div({ dividirJornadasFolgaMeiaNoite: e.target.checked })} />
                    Dividir jornadas quando houver folga antes ou após a meia noite
                  </label>
                  <div className={`ml-6 space-y-1 ${!divFolga ? 'opacity-45 pointer-events-none' : ''}`}>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={dn.naoDividirEmFeriados ?? false} onChange={(e) => div({ naoDividirEmFeriados: e.target.checked })} />
                      Não dividir em feriados
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={dn.naoDividirEmFolgas ?? false} onChange={(e) => div({ naoDividirEmFolgas: e.target.checked })} />
                      Não dividir em folgas
                    </label>
                  </div>
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={dn.naoReiniciarDivisoesDiurnasNoturnas ?? false}
                    onChange={(e) => div({ naoReiniciarDivisoesDiurnasNoturnas: e.target.checked })}
                  />
                  Não reiniciar divisões de extras entre diurnas e noturnas
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-slate-300 dark:border-slate-700 bg-slate-200/50 dark:bg-slate-800/80 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-700 dark:text-slate-300">Copiar configurações do horário</label>
            <select
              className={`${inp} w-52`}
              value={copiarId}
              onChange={(e) => {
                const id = e.target.value;
                setCopiarId(id);
                const ex = getExtrasFromHorario(id || null);
                if (ex) setDraft(mergeExtras(createDefaultExtras(), ex));
              }}
            >
              <option value="">&lt;Nenhum&gt;</option>
              {outrosHorarios.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              className="px-5 py-2 rounded-lg bg-gradient-to-b from-sky-100 to-sky-200 dark:from-slate-700 dark:to-slate-800 border border-slate-400 dark:border-slate-600 text-sm font-medium shadow-sm"
              onClick={() => {
                onApply(draft);
                onClose();
              }}
            >
              OK
            </button>
            <button type="button" className="px-5 py-2 rounded-lg bg-gradient-to-b from-sky-100 to-sky-200 dark:from-slate-700 dark:to-slate-800 border border-slate-400 dark:border-slate-600 text-sm font-medium shadow-sm" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfiguracaoHorasExtrasModal;
