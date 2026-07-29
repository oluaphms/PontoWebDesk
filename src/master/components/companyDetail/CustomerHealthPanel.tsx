import React, { memo } from 'react';
import type { MasterCompanyRow } from '../../types/company';
import { DetailField } from './DetailField';
import { formatDisplayDate } from './displayFormat';

type Props = {
  row: MasterCompanyRow;
  lastAccessAt?: string | null;
  employeesCount?: number | null;
  punchesCount?: number | null;
  integrationsCount?: number | null;
  backupsCount?: number | null;
  usageLabel?: string | null;
  lastActivityAt?: string | null;
};

function fmt(v: string | number | null | undefined): string {
  if (v == null || v === '') return 'Informação indisponível';
  return String(v);
}

/** Saúde do cliente — sem regras novas; dados ausentes → indisponível. */
export const CustomerHealthPanel = memo(function CustomerHealthPanel({
  row,
  lastAccessAt,
  employeesCount,
  punchesCount,
  integrationsCount,
  backupsCount,
  usageLabel,
  lastActivityAt,
}: Props) {
  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-5 space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-teal-600 dark:text-teal-400">
          Saúde do cliente
        </p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Customer Health</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailField
          label="Último login"
          value={lastAccessAt ? formatDisplayDate(lastAccessAt) : 'Informação indisponível'}
        />
        <DetailField label="Funcionários" value={fmt(employeesCount)} />
        <DetailField label="Batidas" value={fmt(punchesCount)} />
        <DetailField label="Integrações" value={fmt(integrationsCount)} />
        <DetailField label="Backups" value={fmt(backupsCount)} />
        <DetailField label="Uso" value={usageLabel || row.storage || 'Informação indisponível'} />
        <DetailField
          label="Última atividade"
          value={
            lastActivityAt
              ? formatDisplayDate(lastActivityAt)
              : lastAccessAt
                ? formatDisplayDate(lastAccessAt)
                : 'Informação indisponível'
          }
        />
      </div>
    </section>
  );
});
