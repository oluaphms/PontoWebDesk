/**
 * Modal — reconciliação assistida para batidas REP com invalid_sequence (sem auto-promote).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '../../components/UI';
import { supabase } from '../services/supabaseClient';
import {
  isRepPunchEligibleForAssistedSequenceReconciliation,
  type PendingRepPunch,
} from '../services/timeAttendanceData';
import { fetchDayTimeRecordsForAudit } from '../services/timeAttendanceAuditReviews';
import { listTimeAttendanceTimelinePage, type TimeAttendanceTimelineRow } from '../services/timeAttendanceTimeline.service';
import { TimeAttendanceTimelineEventType } from '../services/timeAttendanceTimeline.constants';
import { resolvePunchOrigin } from '../utils/punchOrigin';
import {
  ignoreRepPunchWithReason,
  insertManualSaidaForRepSequence,
  markRepPunchInvestigating,
  reconcileRepPunchAsSaida,
  REP_PROMOTE_CLIENT_COOLDOWN_MS,
  tryRepPromoteSingleLogAfterCooldown,
} from '../services/repPendingSequenceReconciliation.service';

export type RepPendingSequenceResolutionModalProps = {
  open: boolean;
  onClose: () => void;
  companyId: string;
  employeeId: string;
  employeeName?: string | null;
  dateYmd: string;
  pendingPunches: PendingRepPunch[];
  initialRepLogId?: string | null;
  reviewedByUserId: string;
  onCompleted: () => void;
};

function formatInstant(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

const TIMELINE_TYPES = [
  TimeAttendanceTimelineEventType.REP_PROMOTE_FAILED,
  TimeAttendanceTimelineEventType.REP_PROMOTE_RETRIED,
  TimeAttendanceTimelineEventType.REP_PROMOTE_RECOVERED,
  TimeAttendanceTimelineEventType.REP_SEQUENCE_RECONCILED,
  TimeAttendanceTimelineEventType.REP_PUNCH_IGNORED,
  TimeAttendanceTimelineEventType.TIMESHEET_RECALCULATED,
  TimeAttendanceTimelineEventType.MANUAL_ADJUSTMENT,
  TimeAttendanceTimelineEventType.TIME_RECORD_CREATED,
  TimeAttendanceTimelineEventType.INCIDENT_DETECTED,
  TimeAttendanceTimelineEventType.INCIDENT_RESOLVED,
] as const;

export const RepPendingSequenceResolutionModal: React.FC<RepPendingSequenceResolutionModalProps> = (props) => {
  const {
    open,
    onClose,
    companyId,
    employeeId,
    employeeName,
    dateYmd,
    pendingPunches,
    initialRepLogId,
    reviewedByUserId,
    onCompleted,
  } = props;

  const eligible = useMemo(
    () => pendingPunches.filter(isRepPunchEligibleForAssistedSequenceReconciliation),
    [pendingPunches],
  );

  const [selectedLogId, setSelectedLogId] = useState<string>(() => eligible[0]?.id ?? '');
  const [timeRecords, setTimeRecords] = useState<Record<string, unknown>[]>([]);
  const [timelineRows, setTimelineRows] = useState<TimeAttendanceTimelineRow[]>([]);
  const [loadingCtx, setLoadingCtx] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteConvert, setNoteConvert] = useState('');
  const [manualTime, setManualTime] = useState('12:00');
  const [noteManual, setNoteManual] = useState('');
  const [ignoreReason, setIgnoreReason] = useState('');

  useEffect(() => {
    if (!open) return;
    const first = initialRepLogId && eligible.some((e) => e.id === initialRepLogId) ? initialRepLogId : eligible[0]?.id;
    setSelectedLogId(first ?? '');
    setError(null);
    setNoteConvert('');
    setNoteManual('');
    setIgnoreReason('');
  }, [open, initialRepLogId, eligible]);

  const loadContext = useCallback(async () => {
    if (!open || !companyId || !employeeId || !dateYmd) return;
    setLoadingCtx(true);
    setError(null);
    try {
      const [recs, tl] = await Promise.all([
        fetchDayTimeRecordsForAudit(companyId, employeeId, dateYmd),
        listTimeAttendanceTimelinePage({
          companyId,
          employeeId,
          dateFrom: dateYmd,
          dateTo: dateYmd,
          limit: 120,
        }),
      ]);
      setTimeRecords(recs);
      setTimelineRows(
        tl.rows.filter((r) => (TIMELINE_TYPES as readonly string[]).includes(r.event_type)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar contexto.');
    } finally {
      setLoadingCtx(false);
    }
  }, [open, companyId, employeeId, dateYmd]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (!open || !selectedLogId || !reviewedByUserId) return;
    void markRepPunchInvestigating({
      companyId,
      repPunchLogId: selectedLogId,
      reviewedBy: reviewedByUserId,
      supabaseClient: supabase,
    }).catch(() => {});
  }, [open, selectedLogId, reviewedByUserId, companyId]);

  const selectedPunch = useMemo(
    () => eligible.find((p) => p.id === selectedLogId) ?? null,
    [eligible, selectedLogId],
  );

  const lastRecordType = useMemo(() => {
    if (!timeRecords.length) return null;
    const last = timeRecords[timeRecords.length - 1] as { type?: string };
    return last?.type ? String(last.type) : null;
  }, [timeRecords]);

  const suggestions = useMemo(() => {
    const out: string[] = [];
    if (lastRecordType === 'entrada') {
      out.push('Existe entrada aberta anterior — uma segunda «entrada» no relógio costuma falhar na sequência.');
    }
    if (lastRecordType === 'intervalo_saida') {
      out.push('Última batida no espelho é saída de intervalo — verifique se falta volta ou saída final.');
    }
    if (!timeRecords.length) {
      out.push('Sem batidas ainda no espelho para este dia — confirme se a primeira marcação REP deve ser entrada ou outro tipo.');
    }
    out.push('O sistema não altera tipos automaticamente: escolha uma ação explícita abaixo ou mantenha pendente.');
    return out;
  }, [lastRecordType, timeRecords.length]);

  const handleConvertSaida = async () => {
    if (!selectedLogId) return;
    setBusy('convert');
    setError(null);
    try {
      const r = await reconcileRepPunchAsSaida({
        companyId,
        employeeId,
        dateYmd,
        repPunchLogId: selectedLogId,
        reviewedBy: reviewedByUserId,
        note: noteConvert || null,
        supabaseClient: supabase,
      });
      if (!r.ok) {
        setError(r.error ?? 'Falha.');
        return;
      }
      onCompleted();
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const handleManualSaida = async () => {
    setBusy('manual');
    setError(null);
    try {
      const r = await insertManualSaidaForRepSequence({
        companyId,
        employeeId,
        dateYmd,
        timeHHmm: manualTime,
        reviewedBy: reviewedByUserId,
        note: noteManual || null,
        supabaseClient: supabase,
      });
      if (!r.ok) {
        setError(r.error ?? 'Falha.');
        return;
      }
      await loadContext();
      onCompleted();
    } finally {
      setBusy(null);
    }
  };

  const handleIgnore = async () => {
    if (!selectedLogId) return;
    setBusy('ignore');
    setError(null);
    try {
      const r = await ignoreRepPunchWithReason({
        companyId,
        employeeId,
        dateYmd,
        repPunchLogId: selectedLogId,
        reviewedBy: reviewedByUserId,
        reason: ignoreReason,
        supabaseClient: supabase,
      });
      if (!r.ok) {
        setError(r.error ?? 'Falha.');
        return;
      }
      onCompleted();
      onClose();
    } finally {
      setBusy(null);
    }
  };

  const handleRepromote = async () => {
    if (!selectedLogId) return;
    setBusy('promote');
    setError(null);
    try {
      const r = await tryRepPromoteSingleLogAfterCooldown({
        companyId,
        employeeId,
        dateYmd,
        repPunchLogId: selectedLogId,
        reviewedBy: reviewedByUserId,
        supabaseClient: supabase,
      });
      if (!r.ok) {
        setError(r.error ?? 'Falha ao promover.');
        return;
      }
      await loadContext();
      onCompleted();
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center p-4 bg-slate-900/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rep-seq-resolution-title"
    >
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Fechar" />
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2 id="rep-seq-resolution-title" className="text-sm font-semibold text-slate-900 dark:text-white pr-2">
            Reconciliação assistida — {dateYmd}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-4 text-sm">
          <p className="text-xs text-amber-900 dark:text-amber-100 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
            <strong className="font-semibold">Batida REP pendente não significa perda da batida.</strong> Significa que a
            sequência operacional ainda não foi reconciliada no espelho. As horas oficiais continuam a vir apenas do motor
            após batidas válidas.
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Colaborador: <span className="font-medium text-slate-800 dark:text-slate-200">{employeeName ?? employeeId}</span>
          </p>

          {eligible.length === 0 ? (
            <p className="text-slate-600 dark:text-slate-400">Nenhuma batida elegível (invalid_sequence ativa) neste contexto.</p>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Batida REP a tratar</p>
                <select
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                  value={selectedLogId}
                  onChange={(e) => setSelectedLogId(e.target.value)}
                >
                  {eligible.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatInstant(p.data_hora)} · NSR {p.nsr ?? '—'} · tent. {p.promotion_attempts ?? 0}
                    </option>
                  ))}
                </select>
                {selectedPunch?.last_promotion_attempt_at ? (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Última tentativa de promote: {formatInstant(selectedPunch.last_promotion_attempt_at)} · cooldown mín.{' '}
                    {REP_PROMOTE_CLIENT_COOLDOWN_MS / 1000}s entre reprocessamentos manuais.
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Sugestões (não automáticas)</p>
                <ul className="list-disc list-inside text-xs text-slate-600 dark:text-slate-400 space-y-1">
                  {suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Batidas no espelho (dia)</p>
                {loadingCtx ? (
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-hidden />
                ) : timeRecords.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhum time_record neste dia.</p>
                ) : (
                  <ul className="space-y-1 text-xs max-h-28 overflow-y-auto border border-slate-100 dark:border-slate-800 rounded-lg p-2">
                    {timeRecords.map((rec, i) => {
                      const r = rec as Record<string, unknown>;
                      const iso = String(r.timestamp ?? r.created_at ?? '');
                      const origin = resolvePunchOrigin(
                        r as { origin?: string | null; source?: string | null; method?: string | null },
                      );
                      return (
                        <li key={String(r.id ?? i)} className="flex flex-wrap gap-x-2">
                          <span className="font-mono">{formatInstant(iso)}</span>
                          <span>{String(r.type ?? '—')}</span>
                          <span className="text-slate-500">{origin.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Timeline operacional (dia)</p>
                {loadingCtx ? null : timelineRows.length === 0 ? (
                  <p className="text-xs text-slate-500">Sem eventos filtrados.</p>
                ) : (
                  <ul className="space-y-1 text-[11px] max-h-32 overflow-y-auto border border-slate-100 dark:border-slate-800 rounded-lg p-2 text-slate-600 dark:text-slate-400">
                    {timelineRows.map((t) => (
                      <li key={t.id}>
                        <span className="font-mono text-slate-500">{formatInstant(t.created_at)}</span>{' '}
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{t.event_type}</span>{' '}
                        {compactTimelinePayloadForList(t.payload)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

              <div className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-3">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Ações explícitas</p>

                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-200">Converter esta batida em saída</p>
                  <p className="text-[11px] text-slate-500">
                    Cria <code className="text-[10px]">time_record</code> tipo saída no horário da marcação REP e vincula a
                    esta linha de fila. Não reescreve o AFD bruto.
                  </p>
                  <input
                    type="text"
                    placeholder="Nota opcional (auditoria)"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
                    value={noteConvert}
                    onChange={(e) => setNoteConvert(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="w-full justify-center"
                    disabled={busy !== null}
                    onClick={() => void handleConvertSaida()}
                  >
                    {busy === 'convert' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Converter em saída
                  </Button>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-200">Inserir saída manual (horário intermédio)</p>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
                    value={manualTime}
                    onChange={(e) => setManualTime(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Nota opcional"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
                    value={noteManual}
                    onChange={(e) => setNoteManual(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full justify-center"
                    disabled={busy !== null}
                    onClick={() => void handleManualSaida()}
                  >
                    {busy === 'manual' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Gravar saída manual
                  </Button>
                </div>

                <div className="rounded-xl border border-rose-200 dark:border-rose-900/40 p-3 space-y-2">
                  <p className="text-xs font-medium text-rose-800 dark:text-rose-200">Ignorar batida REP</p>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs min-h-[64px]"
                    placeholder="Motivo obrigatório — visível na auditoria"
                    value={ignoreReason}
                    onChange={(e) => setIgnoreReason(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full justify-center border-rose-300 text-rose-800 dark:text-rose-200"
                    disabled={busy !== null}
                    onClick={() => void handleIgnore()}
                  >
                    {busy === 'ignore' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Ignorar batida
                  </Button>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-200">Tentar promover novamente</p>
                  <p className="text-[11px] text-slate-500">
                    Chama <code className="text-[10px]">rep_promote_pending_rep_punch_logs</code> só para esta linha, com
                    janela do dia e cooldown.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="w-full justify-center"
                    disabled={busy !== null}
                    onClick={() => void handleRepromote()}
                  >
                    {busy === 'promote' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Reprocessar sequência (promote)
                  </Button>
                </div>

                <Button type="button" size="sm" variant="ghost" className="w-full" disabled={busy !== null} onClick={onClose}>
                  Fechar (manter pendente)
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function compactTimelinePayloadForList(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== 'object') return '';
  try {
    const s = JSON.stringify(payload);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return '';
  }
}
