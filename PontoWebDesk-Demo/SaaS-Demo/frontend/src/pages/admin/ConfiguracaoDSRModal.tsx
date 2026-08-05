import React, { useEffect, useState } from 'react';
import type { DSRConfig } from '../../../types';
import { createDefaultDSR, mergeDSR } from '../../../types';

const inp = 'w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm';

export interface ConfiguracaoDSRModalProps {
  open: boolean;
  onClose: () => void;
  value: DSRConfig;
  /** Chamado apenas ao clicar em OK com o rascunho atual. */
  onApply: (next: DSRConfig) => void;
  outrosHorarios: { id: string; label: string }[];
  /** Retorna o DSR copiado do horário escolhido (ou undefined). */
  getDsrFromHorario: (horarioId: string | null) => DSRConfig | undefined;
}

const ConfiguracaoDSRModal: React.FC<ConfiguracaoDSRModalProps> = ({
  open,
  onClose,
  value,
  onApply,
  outrosHorarios,
  getDsrFromHorario,
}) => {
  const [draft, setDraft] = useState<DSRConfig>(value);
  const [copiarId, setCopiarId] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(mergeDSR(createDefaultDSR(), value));
      setCopiarId('');
    }
  }, [open, value]);

  const set = (partial: Partial<DSRConfig>) => setDraft((d) => ({ ...d, ...partial }));

  const heOn = draft.incluirHorasExtrasNoCalculo ?? false;
  const ferOn = draft.incluirFeriados ?? false;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dsr-modal-title"
      onClick={() => onClose()}
    >
      <div
        className="bg-slate-100 dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-300 dark:border-slate-700 w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800">
          <h2 id="dsr-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
            Configuração de DSR
          </h2>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Descanso</label>
            <select className={`${inp} max-w-[200px]`} value={draft.tipo} onChange={(e) => set({ tipo: e.target.value as 'automatico' | 'variavel' })}>
              <option value="automatico">Automático</option>
              <option value="variavel">Variável</option>
            </select>
          </div>

          {draft.tipo === 'variavel' && (
            <div className="rounded-lg border border-slate-300 dark:border-slate-600 p-3 text-sm text-slate-600 dark:text-slate-400 space-y-2">
              <p>Modo variável: faixas de desconto.</p>
              {(draft.faixasVariavel ?? []).map((fx, i) => (
                <div key={i} className="flex gap-2 items-center flex-wrap">
                  <label className="text-xs">
                    Até{' '}
                    <input
                      type="number"
                      className={`${inp} w-20 inline`}
                      value={fx.ate}
                      onChange={(e) => {
                        const n = [...(draft.faixasVariavel ?? [])];
                        n[i] = { ...fx, ate: Number(e.target.value) || 0 };
                        set({ faixasVariavel: n });
                      }}
                    />{' '}
                    h
                  </label>
                  <label className="text-xs">
                    Desconto{' '}
                    <input
                      type="text"
                      className={`${inp} w-24 inline`}
                      value={fx.desconto}
                      onChange={(e) => {
                        const n = [...(draft.faixasVariavel ?? [])];
                        n[i] = { ...fx, desconto: e.target.value };
                        set({ faixasVariavel: n });
                      }}
                    />
                  </label>
                </div>
              ))}
              <button
                type="button"
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                onClick={() =>
                  set({
                    faixasVariavel: [...(draft.faixasVariavel ?? []), { ate: 8, desconto: '08:00' }],
                  })
                }
              >
                + Adicionar faixa
              </button>
            </div>
          )}

          {draft.tipo === 'automatico' && (
            <div className="rounded-lg border border-slate-300 dark:border-slate-600 p-4 space-y-4 bg-white dark:bg-slate-950/40">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Limite de horas falta</label>
                <input
                  type="time"
                  className={inp}
                  value={draft.limiteHorasFaltasHHmm ?? '06:00'}
                  onChange={(e) => set({ limiteHorasFaltasHHmm: e.target.value })}
                />
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1.5 leading-snug">
                  Caso a soma das horas de falta na semana for superior a este limite, o descanso será descontado.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Valor do DSR</label>
                <input type="time" className={inp} value={draft.valorDSRHoras ?? '00:00'} onChange={(e) => set({ valorDSRHoras: e.target.value })} />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-indigo-600"
                    checked={heOn}
                    onChange={(e) => set({ incluirHorasExtrasNoCalculo: e.target.checked })}
                  />
                  <span className="text-sm text-slate-800 dark:text-slate-200">Incluir Horas Extras no cálculo</span>
                </label>
                <div className={`ml-6 space-y-2 ${!heOn ? 'opacity-45 pointer-events-none' : ''}`}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="he-dest"
                      checked={(draft.horasExtrasNoCalculoDestino ?? 'coluna_dsr') === 'coluna_dsr'}
                      onChange={() => set({ horasExtrasNoCalculoDestino: 'coluna_dsr' })}
                    />
                    Na coluna de DSR
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="he-dest"
                      checked={draft.horasExtrasNoCalculoDestino === 'coluna_separada'}
                      onChange={() => set({ horasExtrasNoCalculoDestino: 'coluna_separada' })}
                    />
                    Em uma coluna separada
                  </label>
                  <label className="flex items-center gap-2 text-sm flex-wrap">
                    <input
                      type="checkbox"
                      checked={draft.diasUteisPorSemanaAtivo ?? false}
                      onChange={(e) => set({ diasUteisPorSemanaAtivo: e.target.checked })}
                    />
                    Dias úteis por semana
                    <input
                      type="number"
                      min={0}
                      max={7}
                      className={`${inp} w-14 inline`}
                      disabled={!(draft.diasUteisPorSemanaAtivo ?? false)}
                      value={draft.diasUteisPorSemana ?? ''}
                      onChange={(e) => set({ diasUteisPorSemana: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </label>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-indigo-600"
                  checked={draft.descontarSemanaSeguinte ?? false}
                  onChange={(e) => set({ descontarSemanaSeguinte: e.target.checked })}
                />
                <span className="text-sm text-slate-800 dark:text-slate-200">Descontar também da semana seguinte</span>
              </label>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-indigo-600"
                    checked={ferOn}
                    onChange={(e) => set({ incluirFeriados: e.target.checked })}
                  />
                  <span className="text-sm text-slate-800 dark:text-slate-200">Incluir feriados</span>
                </label>
                <div className={`ml-6 space-y-2 ${!ferOn ? 'opacity-45 pointer-events-none' : ''}`}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="fer-como"
                      checked={draft.feriadoComo === 'dsr_domingo'}
                      onChange={() => set({ feriadoComo: 'dsr_domingo' })}
                    />
                    Como descanso no domingo
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="fer-como" checked={draft.feriadoComo === 'dsr_dia'} onChange={() => set({ feriadoComo: 'dsr_dia' })} />
                    Como descanso no dia
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="fer-como"
                      checked={draft.feriadoComo === 'hora_normal_dia'}
                      onChange={() => set({ feriadoComo: 'hora_normal_dia' })}
                    />
                    Como Hora Normal no dia
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="fer-como"
                      checked={draft.feriadoComo === 'hora_normal_descanso'}
                      onChange={() => set({ feriadoComo: 'hora_normal_descanso' })}
                    />
                    Como Hora Normal no descanso
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.feriadoDomingoDescontarUmDSR ?? false}
                      onChange={(e) => set({ feriadoDomingoDescontarUmDSR: e.target.checked })}
                    />
                    Caso feriado ocorra em domingo, descontar apenas um DSR
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-slate-300 dark:border-slate-700 bg-slate-200/50 dark:bg-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-700 dark:text-slate-300">Copiar configurações do horário</label>
            <select
              className={`${inp} w-52`}
              value={copiarId}
              onChange={(e) => {
                const id = e.target.value;
                setCopiarId(id);
                const copied = getDsrFromHorario(id || null);
                if (copied) setDraft(mergeDSR(createDefaultDSR(), copied));
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
            <button
              type="button"
              className="px-5 py-2 rounded-lg bg-gradient-to-b from-sky-100 to-sky-200 dark:from-slate-700 dark:to-slate-800 border border-slate-400 dark:border-slate-600 text-sm font-medium shadow-sm"
              onClick={() => onClose()}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfiguracaoDSRModal;
