import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import type { CompanyPlanSubscription, SaasPlan } from '../../api/plansApi';
import {
  installationTypeLabel,
  parseInstallationType,
  type InstallationType,
} from '../../commercial/installationType';
import { formatDisplayDate, formatMoneyBrl } from './displayFormat';

export type SubscriptionPanelData = {
  installationType: InstallationType | string | null | undefined;
  /** Rótulo comercial do tenant (não confundir com assinatura SaaS). */
  commercialPlanLabel: string;
  planSubscription: CompanyPlanSubscription | null;
  saasPlans: SaasPlan[];
  selectedPlanId: string;
  planBusy: boolean;
  canManageSubscription: boolean;
};

export type SubscriptionPanelActions = {
  onSelectedPlanIdChange: (id: string) => void;
  onApplySelectedPlan: () => void;
  onCancelSubscription: () => void;
};

type Props = {
  data: SubscriptionPanelData;
  actions: SubscriptionPanelActions;
};

/** Assinatura SaaS — apresentação + ações via callbacks do orquestrador. */
export const SubscriptionPanel = memo(function SubscriptionPanel({ data, actions }: Props) {
  const {
    installationType,
    commercialPlanLabel,
    planSubscription,
    saasPlans,
    selectedPlanId,
    planBusy,
    canManageSubscription,
  } = data;
  const { onSelectedPlanIdChange, onApplySelectedPlan, onCancelSubscription } = actions;
  const install = parseInstallationType(installationType);

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Assinatura SaaS
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            {install === 'ON_PREMISE'
              ? 'On-premise: somente planos anuais.'
              : 'SaaS Web: somente planos mensais.'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Plano comercial/tenant: <span className="font-medium">{commercialPlanLabel || '—'}</span>
            {' · '}
            Tipo: {installationTypeLabel(install)}
          </p>
          {planSubscription ? (
            <div className="mt-2 space-y-1 text-sm">
              <p className="font-medium text-slate-900 dark:text-white">
                {planSubscription.planName} ·{' '}
                {planSubscription.cycle === 'ANNUAL' ? 'Anual' : 'Mensal'}
              </p>
              <p className="text-xs text-slate-500">
                Valor: {formatMoneyBrl(planSubscription.priceCents)} · Status financeiro:{' '}
                {planSubscription.status} · Próxima cobrança / vence em{' '}
                {formatDisplayDate(planSubscription.expiresAt)}
              </p>
              <p className="text-xs text-slate-500">
                Gateway / PIX / Cartão / Asaas: gerenciados no painel financeiro abaixo
                (quando disponível).
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              Nenhum plano SaaS atribuído (assinatura). Isso é independente do plano comercial
              do tenant acima.
            </p>
          )}
        </div>
        <Link to="/master/plans" className="text-xs text-indigo-600 hover:underline">
          Gerenciar catálogo
        </Link>
      </div>
      {canManageSubscription && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedPlanId}
            onChange={(e) => onSelectedPlanIdChange(e.target.value)}
            className="min-w-[220px] rounded-xl border border-border-strong bg-surface px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">Selecione um plano</option>
            {saasPlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} · {plan.cycle === 'ANNUAL' ? 'Anual' : 'Mensal'} ·{' '}
                {formatMoneyBrl(plan.priceCents)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={planBusy || !selectedPlanId || selectedPlanId === planSubscription?.planId}
            onClick={onApplySelectedPlan}
            className="rounded-xl bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-40"
          >
            {planSubscription ? 'Alterar plano' : 'Atribuir plano'}
          </button>
          {planSubscription && planSubscription.status !== 'CANCELLED' && (
            <button
              type="button"
              disabled={planBusy}
              onClick={onCancelSubscription}
              className="rounded-xl border border-rose-500/30 px-3 py-2 text-xs text-rose-600 disabled:opacity-40"
            >
              Cancelar assinatura
            </button>
          )}
        </div>
      )}
    </section>
  );
});
