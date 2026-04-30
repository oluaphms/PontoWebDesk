import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, MapPin, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../../components/UI';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { TIPOS_BATIDA, mapPunchTypeToDb } from '../constants/punchTypes';
import { localDateAndTimeToIsoUtc } from '../utils/localDateTimeToIso';

interface AddTimeRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { user_id: string; created_at: string; type: string; manual_reason?: string; latitude?: number; longitude?: number }) => Promise<void>;
  userId?: string;
  date?: string;
  employees: { id: string; nome: string }[];
  companyId?: string;
}

interface JustificativaOption {
  id: string;
  codigo: string;
  descricao: string;
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

const MIN_MANUAL_REASON_NO_GPS = 12;

function geolocationErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Permissão de localização negada. Abra o cadeado na barra do endereço e permita o acesso, ou use a opção abaixo para registrar sem GPS.';
    case err.POSITION_UNAVAILABLE:
      return 'Posição indisponível (rede/GPS). Tente perto de uma janela ou use “Registrar sem GPS”.';
    case err.TIMEOUT:
      return 'Tempo esgotado ao obter a posição. Tente “Tentar novamente” ou registro sem GPS.';
    default:
      return 'Não foi possível obter a localização. Tente novamente ou use registro sem GPS.';
  }
}

function getPositionOnce(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/** Rede/Wi‑Fi primeiro (costuma funcionar em desktop); depois GPS de alta precisão. */
async function getPositionBestEffort(): Promise<GeolocationPosition> {
  try {
    return await getPositionOnce({
      enableHighAccuracy: false,
      maximumAge: 300_000,
      timeout: 22_000,
    });
  } catch (first) {
    return await getPositionOnce({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 25_000,
    });
  }
}

export const AddTimeRecordModal: React.FC<AddTimeRecordModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  userId,
  date,
  employees,
  companyId,
}) => {
  const [form, setForm] = useState({
    user_id: userId || '',
    date: date || new Date().toISOString().slice(0, 10),
    time: '09:00',
    type: 'ENTRADA' as string,
    entry_mode: 'HORARIO' as 'HORARIO' | 'STATUS',
    status_type: 'FOLGA' as 'FOLGA' | 'FALTA' | 'EXTRA',
    manual_reason: '',
    justificativa_id: '',
  });
  const [justificativas, setJustificativas] = useState<JustificativaOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [skipGps, setSkipGps] = useState(false);
  const [submitHint, setSubmitHint] = useState<string | null>(null);
  const [adjustmentRequests, setAdjustmentRequests] = useState<AdjustmentRequestOption[]>([]);

  useEffect(() => {
    if (!isOpen || !companyId || !isSupabaseConfigured()) return;
    const loadJustificativas = async () => {
      try {
        const rows = await db.select('justificativas', [
          { column: 'company_id', operator: 'eq', value: companyId }
        ]) as any[];
        setJustificativas(
          (rows ?? [])
            .filter((r: any) => !r.bloquear_uso_web)
            .map((r: any) => ({
              id: r.id,
              codigo: r.codigo || '',
              descricao: r.descricao || '',
            })),
        );
      } catch (e) {
        console.error('Erro ao carregar justificativas:', e);
      }
    };
    loadJustificativas();
  }, [isOpen, companyId]);

  useEffect(() => {
    if (isOpen && userId) {
      setForm((f) => ({ ...f, user_id: userId }));
    }
  }, [isOpen, userId]);

  useEffect(() => {
    if (!isOpen || !form.user_id || !isSupabaseConfigured()) {
      setAdjustmentRequests([]);
      return;
    }
    let cancelled = false;
    const loadAdjustmentRequests = async () => {
      try {
        const rows = (await db.select(
          'requests',
          [
            { column: 'user_id', operator: 'eq', value: form.user_id },
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
  }, [isOpen, form.user_id]);

  const runFetchLocation = useCallback(async () => {
    setLocationError(null);
    setSubmitHint(null);
    setLocationLoading(true);
    setLocation(null);

    if (!navigator.geolocation) {
      setLocationError('Geolocalização não suportada neste navegador. Use “Registrar sem coordenadas GPS”.');
      setLocationLoading(false);
      return;
    }

    try {
      const pos = await getPositionBestEffort();
      setLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
      setSkipGps(false);
    } catch (err) {
      console.error('Erro ao obter localização:', err);
      const msg =
        err && typeof err === 'object' && 'code' in err
          ? geolocationErrorMessage(err as GeolocationPositionError)
          : 'Não foi possível obter a localização.';
      setLocationError(msg);
    } finally {
      setLocationLoading(false);
    }
  }, []);

  // Capturar localização ao abrir o modal
  useEffect(() => {
    if (!isOpen) return;
    setLocation(null);
    setLocationError(null);
    setSkipGps(false);
    setSubmitHint(null);
    void runFetchLocation();
  }, [isOpen, runFetchLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.user_id || !form.date) return;
    if (form.entry_mode === 'HORARIO' && !form.time) return;

    if (form.entry_mode === 'HORARIO' && !location && !skipGps) {
      setSubmitHint('É necessário obter a localização ou marcar o registro sem GPS.');
      return;
    }

    const selectedJustificativaPre = justificativas.find((j) => j.id === form.justificativa_id);
    const combinedReasonPreview =
      form.manual_reason.trim() ||
      (selectedJustificativaPre ? `${selectedJustificativaPre.codigo} - ${selectedJustificativaPre.descricao}` : '');
    if (form.entry_mode === 'HORARIO' && skipGps && combinedReasonPreview.length < MIN_MANUAL_REASON_NO_GPS) {
      setSubmitHint(
        `Sem GPS: preencha o motivo ou escolha uma justificativa (texto combinado com pelo menos ${MIN_MANUAL_REASON_NO_GPS} caracteres).`,
      );
      return;
    }

    setSubmitHint(null);
    setSubmitting(true);
    try {
      const created_at = localDateAndTimeToIsoUtc(form.date, form.entry_mode === 'STATUS' ? '12:00' : form.time);
      const selectedJustificativa = justificativas.find(j => j.id === form.justificativa_id);
      const baseReason = form.manual_reason.trim() ||
        (selectedJustificativa ? `${selectedJustificativa.codigo} - ${selectedJustificativa.descricao}` : '');
      const statusTag = form.entry_mode === 'STATUS' ? `[STATUS:${form.status_type}]` : '';
      let reason = [statusTag, baseReason || (form.entry_mode === 'STATUS' ? 'Lançamento de status' : 'Batida adicionada manualmente')]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (form.entry_mode === 'HORARIO' && skipGps && !location) {
        reason = `${reason}${reason ? ' ' : ''}[Registrado sem coordenadas GPS pelo administrador]`;
      }

      await onSubmit({
        user_id: form.user_id,
        created_at,
        type: mapPunchTypeToDb(form.entry_mode === 'STATUS' ? 'ENTRADA' : form.type),
        manual_reason: reason,
        latitude: location?.lat,
        longitude: location?.lng,
      });
      setForm({
        user_id: userId || '',
        date: date || new Date().toISOString().slice(0, 10),
        time: '09:00',
        type: 'ENTRADA',
        entry_mode: 'HORARIO',
        status_type: 'FOLGA',
        manual_reason: '',
        justificativa_id: '',
      });
      setLocation(null);
      setSkipGps(false);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const combinedReasonLen = useMemo(() => {
    const j = justificativas.find((x) => x.id === form.justificativa_id);
    return (
      form.manual_reason.trim() ||
      (j ? `${j.codigo} - ${j.descricao}` : '')
    ).length;
  }, [form.manual_reason, form.justificativa_id, justificativas]);

  const canSubmitForm = useMemo(() => {
    if (!form.user_id || !form.date) return false;
    if (form.entry_mode === 'STATUS') return true;
    if (!form.time) return false;
    if (location) return true;
    if (skipGps && combinedReasonLen >= MIN_MANUAL_REASON_NO_GPS) return true;
    return false;
  }, [form.user_id, form.date, form.time, form.entry_mode, location, skipGps, combinedReasonLen]);

  if (!isOpen) return null;

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
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Adicionar Batida de Ponto</h3>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
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

            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Tipo de lançamento
              </label>
              <select
                value={form.entry_mode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, entry_mode: e.target.value as 'HORARIO' | 'STATUS' }))
                }
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
                      setForm((f) => ({ ...f, status_type: e.target.value as 'FOLGA' | 'FALTA' | 'EXTRA' }))
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

            {justificativas.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                  Justificativa (opcional)
                </label>
                <select
                  value={form.justificativa_id}
                  onChange={(e) => setForm((f) => ({ ...f, justificativa_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm"
                >
                  <option value="">Selecione uma justificativa</option>
                  {justificativas.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.codigo} - {j.descricao}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">
                Motivo da Batida Manual
              </label>
              <textarea
                value={form.manual_reason}
                onChange={(e) => setForm((f) => ({ ...f, manual_reason: e.target.value }))}
                placeholder="Ex: Funcionário esqueceu de bater ponto, ajuste de horário, etc."
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm resize-none"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Se uma justificativa for selecionada acima e o motivo estiver vazio, será usado o código da justificativa.
              </p>
            </div>

            {adjustmentRequests.length > 0 && (
              <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300 uppercase mb-2">
                  Solicitações de ajuste de ponto (colaborador)
                </p>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {adjustmentRequests.map((req) => (
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

            {form.entry_mode === 'HORARIO' ? (
              <>
                {/* Localização: rede primeiro, depois GPS; fallback sem coordenadas para admin */}
                <div
                  className={`p-3 rounded-lg border flex flex-col gap-3 sm:flex-row sm:items-start ${
                    location
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                      : skipGps
                        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                        : locationError
                          ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {locationLoading ? (
                    <div className="flex items-center gap-3 w-full">
                      <Loader2 className="w-4 h-4 animate-spin text-slate-500 shrink-0" />
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        Obtendo localização (rede e, se necessário, GPS)…
                      </span>
                    </div>
                  ) : location ? (
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3 w-full">
                      <MapPin className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-green-700 dark:text-green-300">
                          Localização capturada
                        </span>
                        <p className="text-[10px] text-green-600 dark:text-green-400 break-all">
                          {location.lat.toFixed(5)}, {location.lng.toFixed(5)} (±{Math.round(location.accuracy)} m)
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 w-full">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                        <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0 space-y-1">
                          <span className="text-xs font-medium text-red-700 dark:text-red-300 block">
                            {locationError ? 'Não foi possível obter a posição' : 'Localização pendente'}
                          </span>
                          {locationError && (
                            <p className="text-[11px] leading-snug text-red-600 dark:text-red-400">{locationError}</p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void runFetchLocation()}
                          disabled={locationLoading}
                          className="text-xs w-full sm:w-auto shrink-0"
                        >
                          Tentar novamente
                        </Button>
                      </div>
                      <label className="flex items-start gap-2 cursor-pointer text-left">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          checked={skipGps}
                          onChange={(e) => {
                            setSkipGps(e.target.checked);
                            setSubmitHint(null);
                          }}
                        />
                        <span className="text-[11px] text-slate-700 dark:text-slate-300 leading-snug">
                          Registrar <strong>sem</strong> coordenadas GPS (útil no escritório ou se o navegador bloquear a
                          localização). É necessário motivo ou justificativa com pelo menos {MIN_MANUAL_REASON_NO_GPS}{' '}
                          caracteres.
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                    <strong>Atenção:</strong> esta batida fica marcada como manual no espelho. Prefira obter a localização;
                    se não for possível, use a opção sem GPS e documente bem o motivo.
                  </p>
                </div>
              </>
            ) : (
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Este lançamento marca o dia como <strong>{form.status_type}</strong> no espelho. Não exige horário nem localização.
                </p>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-slate-100 dark:border-slate-800">
            {submitHint && (
              <p className="px-5 pt-3 text-xs text-red-600 dark:text-red-400 leading-snug">{submitHint}</p>
            )}
            <div className="flex flex-col-reverse sm:flex-row gap-3 px-5 py-4">
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
              disabled={submitting || !canSubmitForm}
            >
              {submitting ? 'Adicionando...' : 'Adicionar Batida'}
            </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
