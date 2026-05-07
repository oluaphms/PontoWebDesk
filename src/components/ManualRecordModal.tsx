import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { Button } from '../../components/UI';

interface ManualRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: string;
  timestamp?: string;
  type?: string;
}

export const ManualRecordModal: React.FC<ManualRecordModalProps> = ({
  isOpen,
  onClose,
  reason,
  timestamp,
  type,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm">
      <div
        className="flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Batida Manual</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 px-5 py-4 space-y-4 min-h-0">
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Esta batida foi adicionada manualmente por um administrador ou RH.
            </p>
          </div>

          {timestamp && (
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Data e Hora
              </label>
              <p className="text-sm text-slate-900 dark:text-white">
                {new Date(timestamp).toLocaleString('pt-BR')}
              </p>
            </div>
          )}

          {type && (
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Tipo de Batida
              </label>
              <p className="text-sm text-slate-900 dark:text-white capitalize">
                {type === 'entrada' && 'Entrada'}
                {type === 'saida' && 'Saída'}
                {type === 'intervalo_saida' && 'Intervalo (Saída)'}
                {type === 'intervalo_volta' && 'Intervalo (Volta)'}
              </p>
            </div>
          )}

          {reason && (
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Motivo
              </label>
              <p className="text-sm text-slate-900 dark:text-white">{reason}</p>
            </div>
          )}

          {!reason && (
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Motivo
              </label>
              <p className="text-sm text-slate-500 dark:text-slate-400 italic">Nenhum motivo registrado</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onClose}
          >
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
};
