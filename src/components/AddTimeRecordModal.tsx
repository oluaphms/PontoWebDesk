import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/UI';

interface AddTimeRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { user_id: string; created_at: string; type: string; latitude?: number; longitude?: number }) => Promise<void>;
  userId?: string;
  date?: string;
  employees: { id: string; nome: string }[];
}

export const AddTimeRecordModal: React.FC<AddTimeRecordModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  userId,
  date,
  employees,
}) => {
  const [form, setForm] = useState({
    user_id: userId || '',
    date: date || new Date().toISOString().slice(0, 10),
    time: '09:00',
    type: 'entrada',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.user_id || !form.date || !form.time) return;

    setSubmitting(true);
    try {
      const created_at = `${form.date}T${form.time}:00.000Z`;
      await onSubmit({
        user_id: form.user_id,
        created_at,
        type: form.type,
      });
      setForm({
        user_id: userId || '',
        date: date || new Date().toISOString().slice(0, 10),
        time: '09:00',
        type: 'entrada',
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Adicionar Batida de Ponto</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Colaborador
              </label>
              <select
                required
                value={form.user_id}
                onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
              >
                <option value="">Selecione um colaborador</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                  Data
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                  Horário
                </label>
                <input
                  type="time"
                  required
                  value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Tipo de Batida
              </label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
              >
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
                <option value="intervalo_saida">Intervalo (Saída)</option>
                <option value="intervalo_volta">Intervalo (Volta)</option>
              </select>
            </div>

            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                <strong>Nota:</strong> Esta batida será registrada como manual. Certifique-se de que o colaborador realmente
                esqueceu de bater o ponto.
              </p>
            </div>
          </div>

          <div className="flex gap-3 px-5 py-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              className="flex-1"
              disabled={submitting || !form.user_id || !form.date || !form.time}
            >
              {submitting ? 'Adicionando...' : 'Adicionar Batida'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
