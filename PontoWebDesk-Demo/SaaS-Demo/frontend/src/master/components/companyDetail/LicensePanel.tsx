import React, { memo } from 'react';
import type { MasterCompanyRow } from '../../types/company';
import { DetailField } from './DetailField';
import { formatDisplayDate } from './displayFormat';

type Props = {
  row: MasterCompanyRow;
};

/**
 * Painel de vigência da licença.
 * Usa exclusivamente licenseValidity — nunca row.status nem fallback inventado.
 */
export const LicensePanel = memo(function LicensePanel({ row }: Props) {
  const v = row.licenseValidity;
  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-5 space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-violet-600 dark:text-violet-400">
          Licença
        </p>
        <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Vigência</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DetailField label="validity (phase)" value={v?.phase ?? '—'} />
        <DetailField label="licenseValidity.label" value={v?.label ?? '—'} />
        <DetailField label="displayStatus" value={v?.displayStatus ?? '—'} />
        <DetailField label="remainingLabel" value={v?.remainingLabel ?? '—'} />
        <DetailField
          label="expiresAt"
          value={v?.expiresAt ? formatDisplayDate(v.expiresAt) : '—'}
        />
        <DetailField
          label="startsAtEffective"
          value={v?.startsAtEffective ? formatDisplayDate(v.startsAtEffective) : '—'}
        />
        <DetailField
          label="daysRemaining"
          value={typeof v?.daysRemaining === 'number' ? String(v.daysRemaining) : '—'}
        />
      </div>
    </section>
  );
});
