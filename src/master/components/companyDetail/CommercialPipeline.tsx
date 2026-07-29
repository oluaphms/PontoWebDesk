import React, { memo } from 'react';
import { ArrowDown, CheckCircle2, Circle, XCircle } from 'lucide-react';
import type { CommercialAutomation, CommercialJourney } from '../../api/companiesApi';
import type { MasterCompanyRow } from '../../types/company';
import type { CrmProfile } from '../../api/crmApi';

type StepStatus = 'done' | 'pending' | 'error';

type PipelineStep = {
  id: string;
  label: string;
  status: StepStatus;
};

type Props = {
  row: MasterCompanyRow;
  journey: CommercialJourney | null;
  automation: CommercialAutomation | null;
  crm?: Pick<CrmProfile, 'contactName' | 'lastAccessAt' | 'deploymentDate'> | null;
};

function icon(status: StepStatus) {
  if (status === 'done') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === 'error') return <XCircle className="h-4 w-4 text-rose-600" />;
  return <Circle className="h-4 w-4 text-slate-400" />;
}

/** Pipeline comercial (apresentação a partir de sinais já existentes). */
export const CommercialPipeline = memo(function CommercialPipeline({
  row,
  journey,
  automation,
  crm,
}: Props) {
  const paymentDone = Boolean(automation?.state.paymentConfirmedAt);
  const autoFailed = automation?.state.status === 'failed';
  const saleDone =
    automation?.state.status === 'completed' ||
    journey?.state === 'completed' ||
    journey?.state === 'awaiting_first_login';
  const implantDone =
    journey?.wizard?.implantationStatus === 'Implantação concluída' ||
    Boolean(journey?.wizard?.implantationCompletedAt);

  const steps: PipelineStep[] = [
    { id: 'lead', label: 'Lead', status: row ? 'done' : 'pending' },
    {
      id: 'contato',
      label: 'Contato',
      status: crm?.contactName || row.administrador ? 'done' : 'pending',
    },
    {
      id: 'negociacao',
      label: 'Negociação',
      status: row.plano ? 'done' : 'pending',
    },
    {
      id: 'pagamento',
      label: 'Pagamento',
      status: autoFailed && !paymentDone ? 'error' : paymentDone ? 'done' : 'pending',
    },
    {
      id: 'venda',
      label: 'Venda',
      status: autoFailed ? 'error' : saleDone ? 'done' : 'pending',
    },
    {
      id: 'implantacao',
      label: 'Implantação',
      status: implantDone ? 'done' : 'pending',
    },
  ];

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-5">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-emerald-600 dark:text-emerald-400">
        Pipeline comercial
      </p>
      <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">Fluxo comercial</h3>
      <ol className="mt-4 space-y-0">
        {steps.map((s, idx) => (
          <li key={s.id}>
            <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
              {icon(s.status)}
              <span className="font-medium text-slate-900 dark:text-white">{s.label}</span>
              <span className="ml-auto text-[10px] uppercase text-slate-400">
                {s.status === 'done' ? 'concluída' : s.status === 'error' ? 'erro' : 'pendente'}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className="flex justify-center py-1 text-slate-300" aria-hidden>
                <ArrowDown className="h-3.5 w-3.5" />
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
});
