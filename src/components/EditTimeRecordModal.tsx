import React, { useState, useEffect } from 'react';
import { X, Trash2, Save, AlertTriangle } from 'lucide-react';
import { Button } from '../../components/UI';
import { TIPOS_BATIDA, mapPunchTypeToDb, dbTypeToPunchEnum } from '../constants/punchTypes';

interface TimeRecord {
  id: string;
  user_id: string;
  type: string;
  created_at: string;
  is_manual?: boolean;
  manual_reason?: string;
  method?: string;
}

interface EditTimeRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (id: string, data: { type: string; created_at: string; manual_reason: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  record: TimeRecord | null;
  employeeName?: string;
}

export const EditTimeRecordModal: React.FC<EditTimeRecordModalProps> = ({
  isOpen,
  onClose,
  onUpdate,
  onDelete,
  record,
  employeeName,
}) => {
  const [form, setForm] = useState({
    date: '',
    time: '',
    type: 'ENTRADA',
    manual_reason: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (record) {
      const dt = new Date(record.created_at);
      setForm({
        date: dt.toISOString().slice(0, 10),
        time: dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        type: dbTypeToPunchEnum(record.type),
        manual_reason: record.manual_reason || '',
      });
      setConfirmDelete(false);
    }
  }, [record]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record || !form.date || !form.time) return;

    setSubmitting(true);
    try {
      const [hours, minutes] = form.time.split(':').map(Number);
      const dt = new Date(form.date);
      dt.setHours(hours, minutes, 0, 0);
      
      await onUpdate(record.id, {
        type: mapPunchTypeToDb(form.type),
        created_at: dt.toISOString(),
        manual_reason: form.manual_reason || `Editado manualmente em ${new Date().toLocaleString('pt-BR')}`,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!record) return;
    
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setSubmitting(true);
    try {
      await onDelete(record.id);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !record) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        className="flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-[95vw] sm:max-w-md max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Editar Batida de Ponto</h3>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleUpdate} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
            {employeeName && (
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  <strong>Colaborador:</strong> {employeeName}
                </p>
              </div>
            )}

            {record.is_manual && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Esta é uma batida manual. Motivo original: {record.manual_reason || 'Não informado'}
                </p>
              </div>
            )}

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
                {TIPOS_BATIDA.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Motivo da Alteração
              </label>
              <textarea
                value={form.manual_reason}
                onChange={(e) => setForm((f) => ({ ...f, manual_reason: e.target.value }))}
                placeholder="Descreva o motivo da alteração..."
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm resize-none"
              />
            </div>

            {confirmDelete && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                  Tem certeza que deseja excluir esta batida? Esta ação não pode ser desfeita.
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3 px-5 py-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={submitting}
              className={`flex items-center gap-2 ${confirmDelete ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30' : ''}`}
            >
              <Trash2 className="w-4 h-4" />
              {confirmDelete ? 'Confirmar Exclusão' : 'Excluir'}
            </Button>
            <div className="flex-1" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => !submitting && onClose()}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !form.date || !form.time}
              className="flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
