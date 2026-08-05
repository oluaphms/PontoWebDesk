import React from 'react';
import { Button } from '../../../../components/UI';
import { Lock, Unlock } from 'lucide-react';

export type TimesheetCloseMonthSectionProps = {
  closingMonth: string;
  onClosingMonthChange: (value: string) => void;
  closingMonthIsClosed: boolean;
  periodClosedLockTooltip: string;
  closingLoading: boolean;
  reopenLoading: boolean;
  filterUserId: string;
  periodValid: boolean;
  closeBlockedByOperational: boolean;
  onCloseMonth: () => void;
  periodClosedLock: boolean;
  periodStart: string;
  periodEnd: string;
  onReopenMonth: () => void;
  periodOperationalBlocked: boolean;
  isAdmin: boolean;
  adminCloseOverride: boolean;
  onAdminCloseOverrideChange: (value: boolean) => void;
};

export function TimesheetCloseMonthSection({
  closingMonth,
  onClosingMonthChange,
  closingMonthIsClosed,
  periodClosedLockTooltip,
  closingLoading,
  reopenLoading,
  filterUserId,
  periodValid,
  closeBlockedByOperational,
  onCloseMonth,
  periodClosedLock,
  periodStart,
  periodEnd,
  onReopenMonth,
  periodOperationalBlocked,
  isAdmin,
  adminCloseOverride,
  onAdminCloseOverrideChange,
}: TimesheetCloseMonthSectionProps) {
  return (
    /* FECHAMENTO MENSAL */
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 shadow-sm backdrop-blur-sm print:hidden">
      <div className="px-4 pt-4 pb-2 border-b border-slate-100 dark:border-slate-800">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Fechamento mensal
        </h2>
      </div>
      <div className="p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Mês a fechar</label>
          <input
            type="month"
            value={closingMonth}
            title={
              closingMonthIsClosed
                ? periodClosedLockTooltip
                : 'Sincronizado com o primeiro dia do período do espelho.'
            }
            onChange={(e) => onClosingMonthChange(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm disabled:opacity-70"
            disabled={closingMonthIsClosed}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="inline-flex items-center gap-2"
          disabled={
            closingLoading ||
            !filterUserId ||
            !periodValid ||
            closingMonthIsClosed ||
            closeBlockedByOperational
          }
          title={
            closingMonthIsClosed
              ? 'Este mês civil já está fechado para o colaborador.'
              : closeBlockedByOperational
                ? 'Há dias com divergência ou erro de cálculo (replay). Corrija ou use override de administrador.'
                : !periodValid
                  ? 'Defina o período completo no espelho.'
                  : undefined
          }
          onClick={() => void onCloseMonth()}
        >
          <Lock className="w-4 h-4" />
          {closingLoading ? 'Fechando…' : 'Fechar folha'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="inline-flex items-center gap-2 border-amber-300 text-amber-900 dark:border-amber-700 dark:text-amber-100 hover:bg-amber-50 dark:hover:bg-amber-950/40"
          disabled={
            reopenLoading ||
            closingLoading ||
            !filterUserId ||
            !periodValid ||
            !periodClosedLock ||
            !/^\d{4}-\d{2}-\d{2}$/.test(String(periodStart).slice(0, 10)) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(String(periodEnd).slice(0, 10))
          }
          title={
            !periodClosedLock
              ? 'Só disponível quando existir pelo menos um mês civil fechado no intervalo do espelho (início a fim).'
              : 'Remove fecho e snapshot do mês civil mais recente ainda fechado nesse intervalo (auditoria registada).'
          }
          onClick={() => void onReopenMonth()}
        >
          <Unlock className="w-4 h-4" aria-hidden />
          {reopenLoading ? 'Reabrindo…' : 'Reabrir mês'}
        </Button>
        {periodOperationalBlocked && !isAdmin && (
          <p className="w-full text-sm text-red-700 dark:text-red-300 mt-2">
            Fechamento bloqueado: existe divergência ou erro de cálculo em pelo menos um dia do período.
            Solicite um administrador para analisar ou aplicar override.
          </p>
        )}
        {periodOperationalBlocked && isAdmin && (
          <label className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-100 mt-2 max-w-xl cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded border-slate-300"
              checked={adminCloseOverride}
              onChange={(e) => onAdminCloseOverrideChange(e.target.checked)}
            />
            <span>
              Permitir fechar a folha mesmo com divergência ou erro de cálculo no período (override
              administrativo — use apenas após validação explícita).
            </span>
          </label>
        )}
      </div>
    </section>
  );
}
