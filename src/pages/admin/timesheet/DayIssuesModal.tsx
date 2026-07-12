import React, { useEffect } from 'react';
import type { PendingRepPunch } from '../../../services/timeAttendanceData';

type DayIssuesModalProps = {
  state: {
    date: string;
    extras: string[];
    inconsistencias: string[];
    repPending: PendingRepPunch[];
  } | null;
  onClose: () => void;
};

function formatDateBR(dateStr: string) {
  const [y, m, day] = dateStr.split('-');
  return `${day}/${m}/${y}`;
}

export function DayIssuesModal({ state, onClose }: DayIssuesModalProps) {
  useEffect(() => {
    if (!state) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            Detalhes de extras/inconsistências - {formatDateBR(state.date)}
          </h3>
          <button
            type="button"
            className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
        <div className="p-4 space-y-4 max-h-[70vh] overflow-auto">
          <div>
            <h4 className="text-sm font-semibold text-purple-700 dark:text-purple-300 mb-1">
              Batidas extras ({state.extras.length})
            </h4>
            {state.extras.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma batida extra.</p>
            ) : (
              <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
                {state.extras.map((item, idx) => (
                  <li key={`extra-${idx}`}>- {item}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-rose-700 dark:text-rose-300 mb-1">
              Inconsistências ({state.inconsistencias.length})
            </h4>
            {state.inconsistencias.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma inconsistência.</p>
            ) : (
              <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
                {state.inconsistencias.map((item, idx) => (
                  <li key={`incons-${idx}`}>- {item}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-1">
              Batidas REP pendentes ({state.repPending.length})
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Evidência em rep_punch_logs (colaborador identificado) ainda sem time_record — não entra no total do motor
              até consolidar.
            </p>
            {state.repPending.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma batida REP pendente neste dia.</p>
            ) : (
              <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                {state.repPending.map((p) => (
                  <li key={p.id} className="border-t border-slate-200 dark:border-slate-700 first:border-0 first:pt-0 pt-2">
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <span className="font-mono text-xs">
                        {new Date(p.data_hora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                      {p.nsr != null && <span className="text-xs text-slate-500">NSR {String(p.nsr)}</span>}
                      <span className="text-xs text-slate-500">{p.source ?? '—'}</span>
                      <span className="text-xs">{p.tipo_marcacao ?? '—'}</span>
                    </div>
                    {(p.promotion_error_code || p.promotion_error_message) && (
                      <p className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">
                        {p.promotion_error_code ? `${p.promotion_error_code}: ` : ''}
                        {p.promotion_error_message ?? ''}
                      </p>
                    )}
                    {p.promotion_attempts != null && (
                      <p className="text-[11px] text-slate-500 mt-0.5">Tentativas: {p.promotion_attempts}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
