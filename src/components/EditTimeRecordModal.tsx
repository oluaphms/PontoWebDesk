import React, { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/UI';
import { isSupabaseConfigured, db } from '../services/supabaseClient';
import { deleteTimeRecord, updateTimeRecord } from '../../services/timeRecords.service';
import { TIPOS_BATIDA, mapPunchTypeToDb, mapDbToPunchType } from '../constants/punchTypes';
import { localDateAndTimeToIsoUtc } from '../utils/localDateTimeToIso';
import { resolvePunchOrigin } from '../utils/punchOrigin';

const STATUS_TAG_REGEX = /\[STATUS:(FOLGA|FALTA|EXTRA)\]/i;

function parseStatusTypeFromReason(manualReason: string | null | undefined): 'FOLGA' | 'FALTA' | 'EXTRA' | null {
  const m = String(manualReason || '').match(STATUS_TAG_REGEX);
  if (!m) return null;
  return m[1].toUpperCase() as 'FOLGA' | 'FALTA' | 'EXTRA';
}

/** Remove o prefixo [STATUS:…] para editar só o texto livre no formulário. */
function stripStatusTag(manualReason: string): string {
  return String(manualReason || '')
    .replace(/\s*\[STATUS:(FOLGA|FALTA|EXTRA)\]\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getReadableManualReason(raw: string | null | undefined): string {
  const txt = String(raw || '').trim();
  if (!txt) return '';
  return stripStatusTag(txt);
}

function toLocalDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLocalTimeHm(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function normalizePunchTypeForMatch(raw: string | null | undefined): string {
  const s = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (s === 'entrada' || s === 'e' || s === 'intervalo_volta' || s === 'intervalo_entrada') return 'entrada';
  if (s === 'saida' || s === 's') return 'saida';
  if (s === 'pausa' || s === 'intervalo_saida' || s === 'p') return 'intervalo_saida';
  return s;
}

interface EditTimeRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: {
    id: string;
    user_id: string;
    created_at: string;
    /** Instante oficial da batida (espelho prioriza sobre created_at). */
    timestamp?: string | null;
    type: string;
    manual_reason?: string | null;
    source?: string | null;
    method?: string | null;
    origin?: string | null;
    source_type?: string | null;
    metadata?: unknown;
    raw_data?: unknown;
  } | null;
  onSave: () => void;
  onUpdated?: (payload: { recordId: string; userId: string; date: string; time: string; type: string }) => void;
  onDeleted?: (payload: { recordId: string; userId: string }) => void;
  readOnly?: boolean;
}

interface AdjustmentRequestOption {
  id: string;
  status: string;
  reason: string;
  created_at: string;
  adjustment_date: string;
  adjustment_time: string;
  punch_type: string;
}

function resolveLaunchedByLabel(record: NonNullable<EditTimeRecordModalProps['record']>): string {
  const origin = resolvePunchOrigin(record);
  if (origin.kind === 'mobile') return 'Colaborador (App)';
  if (origin.kind === 'rep') return 'Relógio de ponto';
  if (origin.kind === 'admin') return 'RH/Admin';
  return 'Sistema';
}

function resolveObservationLabel(record: NonNullable<EditTimeRecordModalProps['record']>): string {
  const origin = resolvePunchOrigin(record);
  if (origin.kind === 'mobile') return 'Observação do app';
  if (origin.kind === 'rep') return 'Observação do relógio';
  if (origin.kind === 'admin') return 'Motivo / Observação (informado pelo RH/Admin)';
  return 'Motivo / Observação';
}

export const EditTimeRecordModal: React.FC<EditTimeRecordModalProps> = ({
  isOpen,
  onClose,
  record,
  onSave,
  onUpdated,
  onDeleted,
  readOnly = false,
}) => {
  const [form, setForm] = useState({
    date: '',
    time: '',
    type: 'ENTRADA',
    entry_mode: 'HORARIO' as 'HORARIO' | 'STATUS',
    status_type: 'FOLGA' as 'FOLGA' | 'FALTA' | 'EXTRA',
    manual_reason: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustmentRequests, setAdjustmentRequests] = useState<AdjustmentRequestOption[]>([]);

  useEffect(() => {
    if (record && isOpen) {
      const instant = record.timestamp && String(record.timestamp).trim() ? record.timestamp : record.created_at;
      const date = new Date(instant);
      const rawReason = record.manual_reason || '';
      const st = parseStatusTypeFromReason(rawReason);
      if (st) {
        setForm({
          date: date.toISOString().slice(0, 10),
          time: '12:00',
          type: 'ENTRADA',
          entry_mode: 'STATUS',
          status_type: st,
          manual_reason: stripStatusTag(rawReason),
        });
      } else {
        setForm({
          date: date.toISOString().slice(0, 10),
          time: date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false }),
          type: mapDbToPunchType(record.type),
          entry_mode: 'HORARIO',
          status_type: 'FOLGA',
          manual_reason: rawReason,
        });
      }
    }
  }, [record, isOpen]);

  useEffect(() => {
    if (!isOpen || !record?.user_id || !isSupabaseConfigured()) {
      setAdjustmentRequests([]);
      return;
    }
    let cancelled = false;
    const loadAdjustmentRequests = async () => {
      try {
        const rows = (await db.select(
          'requests',
          [
            { column: 'user_id', operator: 'eq', value: record.user_id },
            { column: 'type', operator: 'eq', value: 'adjustment' },
          ],
          {
            columns: 'id, status, reason, created_at, metadata',
            orderBy: { column: 'created_at', ascending: false },
            limit: 8,
          },
        )) as Array<{
          id: string;
          status: string;
          reason: string;
          created_at: string;
          metadata?: Record<string, unknown> | null;
        }>;
        if (cancelled) return;
        setAdjustmentRequests(
          (rows || [])
            .map((r) => {
              const md = r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
              const adjustment_date = typeof md.adjustment_date === 'string' ? md.adjustment_date : '';
              const adjustment_time = typeof md.adjustment_time === 'string' ? md.adjustment_time : '';
              const punch_type = typeof md.punch_type === 'string' ? md.punch_type : 'ENTRADA';
              if (!adjustment_date || !adjustment_time) return null;
              return {
                id: r.id,
                status: String(r.status || 'pending'),
                reason: String(r.reason || ''),
                created_at: String(r.created_at || ''),
                adjustment_date,
                adjustment_time,
                punch_type,
              } as AdjustmentRequestOption;
            })
            .filter((x): x is AdjustmentRequestOption => x != null),
        );
      } catch {
        if (!cancelled) setAdjustmentRequests([]);
      }
    };
    void loadAdjustmentRequests();
    return () => {
      cancelled = true;
    };
  }, [isOpen, record?.user_id]);

  const matchingAdjustmentRequests = useMemo(() => {
    if (!record || adjustmentRequests.length === 0) return [];
    const instant = record.timestamp && String(record.timestamp).trim() ? record.timestamp : record.created_at;
    const d = new Date(instant);
    if (Number.isNaN(d.getTime())) return [];

    const recordDate = toLocalDateYmd(d);
    const recordTime = toLocalTimeHm(d);
    const recordType = normalizePunchTypeForMatch(mapDbToPunchType(record.type) || record.type);

    return adjustmentRequests.filter((req) => {
      const reqDate = String(req.adjustment_date || '').trim();
      const reqTime = String(req.adjustment_time || '').slice(0, 5);
      const reqType = normalizePunchTypeForMatch(req.punch_type);

      return reqDate === recordDate && reqTime === recordTime && reqType === recordType;
    });
  }, [adjustmentRequests, record]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !record || !isSupabaseConfigured()) return;

    setSubmitting(true);
    setError(null);

    try {
      const created_at =
        form.entry_mode === 'STATUS'
          ? localDateAndTimeToIsoUtc(form.date, '12:00')
          : localDateAndTimeToIsoUtc(form.date, form.time);

      const statusTag = form.entry_mode === 'STATUS' ? `[STATUS:${form.status_type}]` : '';
      const baseReason = form.manual_reason.trim();
      const manual_reason =
        form.entry_mode === 'STATUS'
          ? [statusTag, baseReason || 'Lançamento de status'].filter(Boolean).join(' ').trim()
          : baseReason || null;

      await updateTimeRecord(record.id, {
        created_at,
        timestamp: created_at,
        updated_at: new Date().toISOString(),
        type: mapPunchTypeToDb(form.entry_mode === 'STATUS' ? 'ENTRADA' : form.type),
        manual_reason,
      });

      onUpdated?.({
        recordId: record.id,
        userId: record.user_id,
        date: form.date,
        time: form.entry_mode === 'STATUS' ? '12:00' : form.time,
        type: form.entry_mode === 'STATUS' ? form.status_type : form.type,
      });
      onSave();
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar batida');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (readOnly || !record || !isSupabaseConfigured()) return;

    if (!confirm('Tem certeza que deseja excluir esta batida?')) return;

    setSubmitting(true);
    setError(null);

    try {
      await deleteTimeRecord(record.id);

      onDeleted?.({
        recordId: record.id,
        userId: record.user_id,
      });
      onSave();
    } catch (err: any) {
      setError(err.message || 'Erro ao excluir batida');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !record) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {readOnly ? 'Detalhes da Batida' : 'Editar Batida'}
          </h3>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {readOnly ? (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Data</p>
                  <p className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm">
                    {form.date || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Horário</p>
                  <p className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm">
                    {form.entry_mode === 'STATUS' ? '—' : (form.time || '—')}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Tipo de lançamento</p>
                  <p className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm">
                    {form.entry_mode === 'STATUS' ? 'Status' : 'Batida (horário)'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    {form.entry_mode === 'STATUS' ? 'Status' : 'Tipo de batida'}
                  </p>
                  <p className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm">
                    {form.entry_mode === 'STATUS'
                      ? form.status_type
                      : (TIPOS_BATIDA.find((t) => t.value === form.type)?.label || form.type || '—')}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Lançado por</p>
                <p className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm">
                  {resolveLaunchedByLabel(record)}
                </p>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                  {resolveObservationLabel(record)}
                </p>
                <p className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm whitespace-pre-wrap">
                  {getReadableManualReason(record.manual_reason) || 'Sem observação informada'}
                </p>
              </div>

              {matchingAdjustmentRequests.length > 0 && (
                <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                  <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase mb-2">
                    Solicitação de ajuste vinculada a esta batida
                  </p>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {matchingAdjustmentRequests.map((req) => (
                      <div
                        key={req.id}
                        className="rounded-md border border-indigo-100 dark:border-indigo-900/40 bg-white/80 dark:bg-slate-800/70 p-2"
                      >
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                          {req.adjustment_date} {req.adjustment_time.slice(0, 5)} - {req.punch_type} - status: {req.status}
                        </p>
                        <p className="text-xs text-slate-800 dark:text-slate-200 mt-0.5 whitespace-pre-wrap">
                          {req.reason || 'Sem motivo informado'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-100 dark:border-slate-800">
              <div className="px-5 py-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={onClose}
                >
                  Fechar
                </Button>
              </div>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Tipo de lançamento
              </label>
              <select
                value={form.entry_mode}
                onChange={(e) => {
                  const mode = e.target.value as 'HORARIO' | 'STATUS';
                  setForm((f) => ({
                    ...f,
                    entry_mode: mode,
                    ...(mode === 'STATUS' ? { time: '12:00', type: 'ENTRADA' as const } : {}),
                  }));
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
              >
                <option value="HORARIO">Batida (horário)</option>
                <option value="STATUS">Status (Folga/Falta/Extra)</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              {form.entry_mode === 'HORARIO' ? (
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
              ) : (
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                    Status
                  </label>
                  <select
                    value={form.status_type}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        status_type: e.target.value as 'FOLGA' | 'FALTA' | 'EXTRA',
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                  >
                    <option value="FOLGA">Folga</option>
                    <option value="FALTA">Falta</option>
                    <option value="EXTRA">Extra</option>
                  </select>
                </div>
              )}
            </div>

            {form.entry_mode === 'HORARIO' && (
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
            )}

            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Motivo / Observação
              </label>
              <textarea
                value={form.manual_reason}
                onChange={(e) => setForm((f) => ({ ...f, manual_reason: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm resize-none"
              />
            </div>

            {matchingAdjustmentRequests.length > 0 && (
              <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase mb-2">
                  Solicitação de ajuste vinculada a esta batida
                </p>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {matchingAdjustmentRequests.map((req) => (
                    <div
                      key={req.id}
                      className="rounded-md border border-indigo-100 dark:border-indigo-900/40 bg-white/80 dark:bg-slate-800/70 p-2"
                    >
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        {req.adjustment_date} {req.adjustment_time.slice(0, 5)} - {req.punch_type} - status: {req.status}
                      </p>
                      <p className="text-xs text-slate-800 dark:text-slate-200 mt-0.5 whitespace-pre-wrap">
                        {req.reason || 'Sem motivo informado'}
                      </p>
                      <button
                        type="button"
                        className="mt-1 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            manual_reason: `Solicitação #${req.id.slice(0, 8)} (${req.adjustment_date} ${req.adjustment_time.slice(0, 5)} ${req.punch_type}): ${req.reason || 'sem motivo informado'}`,
                          }))
                        }
                      >
                        Usar no motivo
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-col-reverse sm:flex-row gap-3 px-5 py-4">
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="flex-1"
                onClick={handleDelete}
                disabled={submitting}
              >
                Excluir
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => !submitting && onClose()}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                className="flex-1"
                disabled={submitting}
              >
                {submitting ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};

export default EditTimeRecordModal;
