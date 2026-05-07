import React, { useEffect, useState } from 'react';
import { XCircle, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button, LoadingState } from '../../components/UI';
import { AdjustmentHistoryService, AdjustmentHistoryEntry } from '../services/adjustmentHistoryService';

interface AdjustmentHistoryModalProps {
  adjustmentId: string;
  onClose: () => void;
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'approved':
      return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
    case 'rejected':
      return <AlertCircle className="w-4 h-4 text-red-600" />;
    case 'pending':
      return <Clock className="w-4 h-4 text-amber-600" />;
    default:
      return <Clock className="w-4 h-4 text-slate-400" />;
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'approved':
      return 'Aprovado';
    case 'rejected':
      return 'Rejeitado';
    case 'pending':
      return 'Pendente';
    default:
      return status;
  }
}

export const AdjustmentHistoryModal: React.FC<AdjustmentHistoryModalProps> = ({
  adjustmentId,
  onClose,
}) => {
  const [history, setHistory] = useState<AdjustmentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadHistory = async () => {
      setLoading(true);
      try {
        const entries = await AdjustmentHistoryService.getAdjustmentHistory(adjustmentId);
        setHistory(entries);
      } catch (e) {
        console.error('Erro ao carregar histórico:', e);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [adjustmentId]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Histórico de Mudanças</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {loading ? (
            <LoadingState message="Carregando histórico..." />
          ) : history.length === 0 ? (
            <div className="text-center text-slate-500 dark:text-slate-400 py-8">
              Nenhuma mudança registrada
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((entry, idx) => (
                <div
                  key={entry.id}
                  className="flex gap-4 pb-4 border-b border-slate-100 dark:border-slate-800 last:border-0"
                >
                  {/* Timeline dot */}
                  <div className="flex flex-col items-center">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800">
                      {getStatusIcon(entry.new_status)}
                    </div>
                    {idx < history.length - 1 && (
                      <div className="w-0.5 h-8 bg-slate-200 dark:bg-slate-700 mt-2" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {entry.old_status ? `${getStatusLabel(entry.old_status)} → ` : ''}
                        {getStatusLabel(entry.new_status)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {new Date(entry.changed_at).toLocaleString('pt-BR')}
                    </p>

                    {entry.reason && (
                      <p className="text-sm text-slate-700 dark:text-slate-300 mt-2">
                        {entry.reason}
                      </p>
                    )}

                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                          Detalhes técnicos
                        </summary>
                        <pre className="mt-2 p-2 bg-slate-50 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300 overflow-x-auto">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
          <Button variant="outline" size="sm" className="w-full" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
};
