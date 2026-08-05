import React from 'react';
import {
  DRIFT_ALERT_COPY,
  type PeriodHealthSummary,
} from '../../../utils/timesheetOperationalUx';

export type PeriodCalculationHealthSectionProps = {
  periodValid: boolean;
  filterUserId: string;
  hasOperationalStatuses: boolean;
  periodHealthSummary: PeriodHealthSummary;
  periodDatesCount: number;
  periodHasDrift: boolean;
  repPendingReconciliationCount: number | null;
};

export function PeriodCalculationHealthSection({
  periodValid,
  filterUserId,
  hasOperationalStatuses,
  periodHealthSummary,
  periodDatesCount,
  periodHasDrift,
  repPendingReconciliationCount,
}: PeriodCalculationHealthSectionProps) {
  return (
    <>
      {/* Saúde do cálculo + alerta de drift */}
      {periodValid && filterUserId && hasOperationalStatuses && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 shadow-sm print:hidden">
          <div className="px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Saúde do cálculo (período)
            </h2>
          </div>
          <div className="p-4 grid grid-cols-2 lg:grid-cols-7 gap-3 text-sm">
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 bg-emerald-50/80 dark:bg-emerald-950/20">
              <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">Confiável</div>
              <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                {periodHealthSummary.pctReliable}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 bg-amber-50/80 dark:bg-amber-950/20">
              <div className="text-xs font-semibold text-amber-800 dark:text-amber-200">Com fallback</div>
              <div className="text-lg font-bold text-amber-800 dark:text-amber-300">
                {periodHealthSummary.pctFallback}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 bg-amber-50/60 dark:bg-amber-950/15">
              <div className="text-xs font-semibold text-amber-900 dark:text-amber-100">Com drift</div>
              <div className="text-lg font-bold text-amber-900 dark:text-amber-200">
                {periodHealthSummary.pctDrift}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 bg-rose-50/80 dark:bg-rose-950/25">
              <div className="text-xs font-semibold text-rose-800 dark:text-rose-200">Divergência</div>
              <div className="text-lg font-bold text-rose-700 dark:text-rose-300">
                {periodHealthSummary.pctInconsistent}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 bg-red-50/80 dark:bg-red-950/25">
              <div className="text-xs font-semibold text-red-800 dark:text-red-200">Erro</div>
              <div className="text-lg font-bold text-red-700 dark:text-red-300">
                {periodHealthSummary.pctError}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 text-slate-600 dark:text-slate-400 col-span-2 lg:col-span-2">
              <div className="text-xs font-semibold">Dias com linha calculada</div>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {periodHealthSummary.total} / {periodDatesCount}
              </div>
            </div>
          </div>
          {periodHealthSummary.pctOther > 0 && (
            <p className="px-4 pb-2 text-xs text-slate-500 dark:text-slate-400">
              Outros estados (protegido / referência inválida): {periodHealthSummary.pctOther}% dos dias com linha
              calculada.
            </p>
          )}
          {periodHasDrift && (
            <div
              className="mx-4 mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-950 dark:text-amber-100"
              role="status"
            >
              <strong className="font-semibold">Drift de regras ou motor:</strong> {DRIFT_ALERT_COPY}
            </div>
          )}
        </section>
      )}

      {periodValid && filterUserId && repPendingReconciliationCount != null && repPendingReconciliationCount > 0 && (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-950 dark:text-amber-100 print:hidden"
          role="status"
        >
          <strong className="font-semibold">Batidas REP pendentes de reconciliação:</strong>{' '}
          {repPendingReconciliationCount} no período selecionado (registadas no REP com colaborador identificado, ainda sem
          linha no espelho — em geral sequência operacional ou regra do espelho). Ver Monitor REP,{' '}
          <code className="text-xs">rep_punch_logs</code> e incidentes operacionais.
        </div>
      )}
    </>
  );
}
