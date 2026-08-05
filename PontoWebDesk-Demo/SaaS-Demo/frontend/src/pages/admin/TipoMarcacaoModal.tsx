import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { TipoMarcacaoConfig } from '../../../types';
import { createDefaultTipoMarcacao, mergeTipoMarcacao } from '../../../types';

const inp =
  'w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm';

const OPCOES_PRINCIPAIS: {
  tipo: 'pre_assinalado' | 'normal';
  label: string;
  descricao: string;
  destaque?: boolean;
}[] = [
  {
    tipo: 'pre_assinalado',
    label: 'Pré-Assinalado',
    descricao: 'Registra batida automaticamente, caso haja batida no dia',
    destaque: true,
  },
  {
    tipo: 'normal',
    label: 'Normal',
    descricao: 'Aceita a batida a qualquer hora',
  },
];

export interface TipoMarcacaoModalProps {
  open: boolean;
  onClose: () => void;
  value: TipoMarcacaoConfig;
  onApply: (next: TipoMarcacaoConfig) => void;
}

const TipoMarcacaoModal: React.FC<TipoMarcacaoModalProps> = ({ open, onClose, value, onApply }) => {
  const [draft, setDraft] = useState<TipoMarcacaoConfig>(value);
  const [view, setView] = useState<'principal' | 'tolerancia'>('principal');

  useEffect(() => {
    if (open) {
      const merged = mergeTipoMarcacao(createDefaultTipoMarcacao(), value);
      setDraft(merged);
      setView(merged.tipo === 'tolerancia_especifica' ? 'tolerancia' : 'principal');
    }
  }, [open, value]);

  if (!open) return null;

  const selecionar = (tipo: 'pre_assinalado' | 'normal') => {
    setDraft((d) => ({ ...d, tipo }));
  };

  const limpar = () => {
    setDraft(createDefaultTipoMarcacao());
    setView('principal');
  };

  const fechar = () => {
    onApply(mergeTipoMarcacao(createDefaultTipoMarcacao(), draft));
    onClose();
  };

  const toleranciaRows = draft.toleranciaEspecial?.length
    ? draft.toleranciaEspecial
    : [{ entrada: 0, saida: 0 }];

  const setToleranciaRow = (idx: number, patch: Partial<{ entrada: number; saida: number }>) => {
    setDraft((d) => {
      const base = d.toleranciaEspecial?.length ? [...d.toleranciaEspecial] : [{ entrada: 0, saida: 0 }];
      const next = [...base];
      next[idx] = { ...next[idx], ...patch };
      return { ...d, toleranciaEspecial: next };
    });
  };

  return (
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tipo-marcacao-titulo"
      onClick={onClose}
    >
      <div
        className="bg-slate-100 dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-300 dark:border-slate-700 w-full max-w-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-300 dark:border-slate-700 bg-slate-200/80 dark:bg-slate-800 shrink-0">
          <h2 id="tipo-marcacao-titulo" className="text-base font-bold text-slate-900 dark:text-white">
            {view === 'tolerancia' ? 'Tolerância específica' : 'Tipo de marcação'}
          </h2>
        </div>

        <div className="p-4 text-sm max-h-[70vh] overflow-y-auto">
          {view === 'principal' && (
            <div className="space-y-4">
              <div className="space-y-2">
                {OPCOES_PRINCIPAIS.map((op) => {
                  const sel = draft.tipo === op.tipo;
                  return (
                    <button
                      key={op.tipo}
                      type="button"
                      onClick={() => selecionar(op.tipo)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        limpar();
                      }}
                      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                        sel
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-500/30'
                          : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-950/30 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      <div
                        className={`font-medium ${op.destaque ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-slate-100'}`}
                      >
                        {op.label}
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 text-xs mt-1 leading-snug">{op.descricao}</div>
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Para desabilitar o tipo escolhido, use o botão Limpar ou clique com o botão direito sobre a opção.
              </p>
              <button
                type="button"
                onClick={limpar}
                className="text-sm font-medium text-slate-700 dark:text-slate-300 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-400"
              >
                Limpar
              </button>

              {draft.tipo !== 'pre_assinalado' && draft.tipo !== 'normal' && (
                <p className="text-xs text-amber-800 dark:text-amber-200/90 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-2 py-1.5">
                  Modo avançado ativo ({draft.tipo}). Use &quot;Tolerância específica&quot; abaixo ou Limpar para voltar a Normal.
                </p>
              )}
            </div>
          )}

          {view === 'tolerancia' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setView('principal')}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-400"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </button>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configure tolerâncias distintas para entrada e saída quando o tipo for &quot;Tolerância específica&quot;.
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.usarToleranciaEspecial ?? false}
                  onChange={(e) => setDraft((d) => ({ ...d, usarToleranciaEspecial: e.target.checked }))}
                />
                <span>Usar tolerância especial</span>
              </label>
              <div className={`space-y-2 ${!(draft.usarToleranciaEspecial ?? false) ? 'opacity-45 pointer-events-none' : ''}`}>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Faixas (minutos)</p>
                {toleranciaRows.map((row, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 w-16">Entrada</span>
                    <input
                      type="number"
                      min={0}
                      className={`${inp} w-24`}
                      value={row.entrada}
                      onChange={(e) => setToleranciaRow(idx, { entrada: Number(e.target.value) || 0 })}
                    />
                    <span className="text-xs text-slate-500">Saída</span>
                    <input
                      type="number"
                      min={0}
                      className={`${inp} w-24`}
                      value={row.saida}
                      onChange={(e) => setToleranciaRow(idx, { saida: Number(e.target.value) || 0 })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-slate-300 dark:border-slate-700 bg-slate-200/50 dark:bg-slate-800/80 shrink-0">
          {view === 'principal' ? (
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-slate-400 dark:border-slate-600 text-sm font-medium bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 order-2 sm:order-1"
              onClick={() => {
                setDraft((d) => ({ ...d, tipo: 'tolerancia_especifica' }));
                setView('tolerancia');
              }}
            >
              Tolerância Específica
            </button>
          ) : (
            <div className="order-2 sm:order-1" />
          )}
          <button
            type="button"
            className="px-5 py-2 rounded-lg bg-gradient-to-b from-sky-100 to-sky-200 dark:from-slate-700 dark:to-slate-800 border border-slate-400 dark:border-slate-600 text-sm font-medium shadow-sm order-1 sm:order-2 sm:ml-auto"
            onClick={fechar}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default TipoMarcacaoModal;
