import React, { memo } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CommercialAutomation, CommercialJourney } from '../../api/companiesApi';
import type { MasterCompanyRow } from '../../types/company';
import { DetailField } from './DetailField';

type Props = {
  row: MasterCompanyRow;
  journey: CommercialJourney | null;
  automation: CommercialAutomation | null;
};

/**
 * Logs técnicos — accordion fechado por padrão (`<details>`).
 * Somente visualização dos IDs/sinais já disponíveis (sem fetch).
 */
export const TechnicalLogsPanel = memo(function TechnicalLogsPanel({
  row,
  journey,
  automation,
}: Props) {
  return (
    <section
      id="technical-logs"
      className="scroll-mt-6 rounded-2xl border border-border bg-surface shadow-card"
    >
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 marker:content-none [&::-webkit-details-marker]:hidden">
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
              Logs técnicos
            </p>
            <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">
              Recovery · Transactions · Provisionamento · Locks
            </h3>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t border-border px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailField label="Tenant ID" value={journey?.tenantId || row.id} mono />
            <DetailField
              label="Operational company ID"
              value={journey?.operationalCompanyId || row.operationalCompanyId || '—'}
              mono
            />
            <DetailField label="License ID" value={journey?.licenseId || '—'} mono />
            <DetailField label="Admin user ID" value={journey?.adminUserId || '—'} mono />
            <DetailField label="Automation status" value={automation?.state.status || '—'} />
            <DetailField label="Journey state" value={journey?.state || '—'} />
            <DetailField
              label="Last automation error"
              value={automation?.state.lastError || '—'}
            />
            <DetailField
              label="Payment ref"
              value={
                automation?.state.paymentRef
                  ? `${automation.state.paymentRef.type}:${automation.state.paymentRef.id}`
                  : '—'
              }
              mono
            />
            <DetailField label="Recovery" value="Informação indisponível" />
            <DetailField label="Transactions" value="Informação indisponível" />
            <DetailField label="Retry / Workers" value="Informação indisponível" />
            <DetailField label="Crash Recovery" value="Informação indisponível" />
            <DetailField label="Locks" value="Informação indisponível" />
          </div>
          <p className="text-[11px] text-slate-500">
            Exportação de auditoria completa permanece nos módulos Master de auditoria/logs
            (sem novo endpoint nesta tela).
          </p>
        </div>
      </details>
    </section>
  );
});
