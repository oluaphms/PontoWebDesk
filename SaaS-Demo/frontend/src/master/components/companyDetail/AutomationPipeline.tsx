import React, { memo } from 'react';
import { ArrowDown, CheckCircle2, Circle, XCircle, Zap, History } from 'lucide-react';
import type { CommercialAutomation } from '../../api/companiesApi';
import { formatDisplayDate } from './displayFormat';

type Props = {
  automation: CommercialAutomation | null;
  automationBusy: boolean;
  onConfirmPayment: () => void;
  onRetryAutomation: () => void;
  /** Quando o admin já autenticou, o step de convite não fica em falha permanente. */
  inviteResolved?: boolean;
};

type Step = { id: string; label: string; done: boolean; failed?: boolean };

/** Pipeline visual da automação — apresentação. */
export const AutomationPipeline = memo(function AutomationPipeline({
  automation,
  automationBusy,
  onConfirmPayment,
  onRetryAutomation,
  inviteResolved = false,
}: Props) {
  const tl = automation?.state.timeline ?? [];
  const has = (step: string, okOnly = false) =>
    tl.some((ev) => ev.step === step && (!okOnly || ev.ok !== false));
  const failedStep = (step: string) =>
    !inviteResolved && tl.some((ev) => ev.step === step && ev.ok === false);
  const status = automation?.state.status;
  const inviteFailed =
    !inviteResolved &&
    status === 'completed' &&
    tl.some((ev) => ev.step === 'first_access_sent' && ev.ok === false);

  const provisionDone =
    has('license_created') ||
    has('company_released') ||
    has('system_ready') ||
    status === 'completed';

  const steps: Step[] = [
    {
      id: 'payment',
      label: 'Pagamento',
      done: Boolean(automation?.state.paymentConfirmedAt) || has('payment_confirmed'),
    },
    {
      id: 'tenant',
      label: 'Criar tenant',
      done: provisionDone || has('client_registered'),
      failed: status === 'failed' && !provisionDone,
    },
    {
      id: 'company',
      label: 'Criar empresa',
      done: provisionDone || has('company_released') || has('client_registered'),
      failed: status === 'failed' && !has('company_released') && !provisionDone,
    },
    {
      id: 'admin',
      label: 'Criar administrador',
      done: provisionDone,
      failed: status === 'failed' && !provisionDone,
    },
    {
      id: 'license',
      label: 'Criar licença',
      done: has('license_created') || provisionDone,
      failed: failedStep('license_created') || (status === 'failed' && !has('license_created')),
    },
    {
      id: 'invite',
      label: inviteResolved ? 'Usuário ativo' : 'Enviar convite',
      done: inviteResolved || has('first_access_sent', true),
      failed: failedStep('first_access_sent') || inviteFailed,
    },
    {
      id: 'done',
      label: 'Provisionamento concluído',
      done: status === 'completed' || has('system_ready'),
      failed: status === 'failed',
    },
  ];

  const description =
    status === 'completed'
      ? inviteFailed
        ? 'Provisionamento concluído. Convite pendente — use Reenviar convite.'
        : inviteResolved
          ? 'Sistema pronto para uso. Administrador ativo.'
          : 'Sistema pronto para uso. Pagamento foi confirmado manualmente (sem provedor de pagamento).'
      : status === 'failed'
        ? `Falha no provisionamento: ${automation?.state.lastError || 'erro desconhecido'}. Pagamento permanece confirmado — use Retomar.`
        : status === 'running'
          ? 'Pipeline automático em execução…'
          : 'Após confirmar o pagamento no Master, licença, empresa, admin e updater rodam sozinhos. O convite é etapa independente.';

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-emerald-600 dark:text-emerald-400">
            Automação comercial
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
            Pagamento manual → ativação automática
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>
          {automation?.state.paymentConfirmedAt && (
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Pagamento confirmado em{' '}
              {formatDisplayDate(automation.state.paymentConfirmedAt)}
              {automation.state.paymentRef
                ? ` · ${automation.state.paymentRef.type}:${automation.state.paymentRef.id}`
                : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {status === 'failed' && (
            <button
              type="button"
              disabled={automationBusy}
              onClick={onRetryAutomation}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
            >
              <History className="w-3.5 h-3.5" />
              Retomar automação
            </button>
          )}
          {status !== 'completed' && status !== 'running' && (
            <button
              type="button"
              disabled={automationBusy}
              onClick={onConfirmPayment}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              <Zap className="w-3.5 h-3.5" />
              {automationBusy ? 'Ativando…' : 'Confirmar pagamento e ativar'}
            </button>
          )}
        </div>
      </div>

      <ol className="mt-5 space-y-0">
        {steps.map((s, idx) => {
          const Icon = s.failed ? XCircle : s.done ? CheckCircle2 : Circle;
          return (
            <li key={s.id}>
              <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                <Icon
                  className={`h-4 w-4 ${
                    s.failed
                      ? 'text-rose-600'
                      : s.done
                        ? 'text-emerald-600'
                        : 'text-slate-400'
                  }`}
                />
                <span className="font-medium text-slate-900 dark:text-white">{s.label}</span>
              </div>
              {idx < steps.length - 1 && (
                <div className="flex justify-center py-1 text-slate-300" aria-hidden>
                  <ArrowDown className="h-3.5 w-3.5" />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
});
