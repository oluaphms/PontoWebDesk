import React, { memo } from 'react';
import { Building2 } from 'lucide-react';
import type { MasterCompanyRow } from '../../types/company';
import { toCompanyStatusPt } from '../../types/company';
import { MasterStatusBadge } from '../MasterStatusBadge';
import { DetailField } from './DetailField';
import { formatDisplayDate } from './displayFormat';
import {
  installationTypeLabel,
  parseInstallationType,
} from '../../commercial/installationType';

type Props = {
  row: MasterCompanyRow;
  lastAccessAt?: string | null;
  contactName?: string | null;
};

/** Resumo executivo — somente apresentação. */
export const CommercialSummaryCard = memo(function CommercialSummaryCard({
  row,
  lastAccessAt,
  contactName,
}: Props) {
  const admin =
    row.administradorEmail
      ? `${row.administrador} <${row.administradorEmail}>`
      : row.administrador;

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-5 space-y-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-2.5 text-indigo-700 dark:text-indigo-300">
          <Building2 className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-indigo-600 dark:text-indigo-400">
            Resumo executivo
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white tracking-tight truncate">
            {row.empresa}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span>{row.document || 'Sem CNPJ'}</span>
            <span>·</span>
            <span>{row.modo}</span>
            <span>·</span>
            <MasterStatusBadge status={row.status} />
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-600 dark:text-slate-400">{row.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DetailField label="Empresa" value={row.empresa} />
        <DetailField label="Responsável" value={contactName || admin || '—'} />
        <DetailField
          label="Plano (comercial/tenant)"
          value={row.plano || '—'}
        />
        <DetailField
          label="Tipo da licença"
          value={installationTypeLabel(parseInstallationType(row.installationType))}
        />
        <DetailField label="Situação comercial" value={toCompanyStatusPt(row.status)} />
        <DetailField label="Situação técnica" value={row.modo || '—'} />
        <DetailField
          label="Situação da licença"
          value={row.licenseValidity?.displayStatus || '—'}
        />
        <DetailField label="Administrador" value={admin || '—'} />
        <DetailField
          label="Último acesso"
          value={lastAccessAt ? formatDisplayDate(lastAccessAt) : 'Informação indisponível'}
        />
        <DetailField label="Data cadastro" value={formatDisplayDate(row.data)} />
        <DetailField label="Domínio" value={row.dominio || '—'} />
        {row.operationalCompanyId ? (
          <DetailField label="ID operacional" value={row.operationalCompanyId} mono />
        ) : null}
      </div>
    </section>
  );
});
