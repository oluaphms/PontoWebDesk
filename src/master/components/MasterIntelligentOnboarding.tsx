import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  ArrowDown,
  Clock3,
  ListTodo,
  Rocket,
  User,
  Route,
} from 'lucide-react';
import type {
  CommercialAutomation,
  CommercialJourney,
} from '../api/companiesApi';
import type { CrmProfile } from '../api/crmApi';
import type { MasterCompanyRow } from '../types/company';
import {
  deriveIntelligentOnboarding,
  type OnboardingMilestone,
} from '../ux/deriveIntelligentOnboarding';
import { MasterVisualTimeline } from './MasterVisualTimeline';
import { MasterStatusBadge } from './MasterStatusBadge';

type Props = {
  companyId: string;
  journey: CommercialJourney | null;
  automation?: CommercialAutomation | null;
  company?: MasterCompanyRow | null;
  crm?: Pick<CrmProfile, 'lastAccessAt' | 'deploymentDate' | 'contactName' | 'email'> | null;
  /** Link para o wizard passo a passo. */
  showWizardLink?: boolean;
  compact?: boolean;
  /** Quando false, timelines ficam a cargo do UnifiedTimeline do orquestrador. */
  showTimelines?: boolean;
};

function MilestoneIcon({ status }: { status: OnboardingMilestone['status'] }) {
  if (status === 'completed') {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />;
  }
  if (status === 'failed') {
    return <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />;
  }
  if (status === 'current') {
    return (
      <span className="relative flex h-5 w-5 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400/40" />
        <Circle className="relative h-5 w-5 fill-indigo-500/20 text-indigo-600 dark:text-indigo-300" />
      </span>
    );
  }
  return <Circle className="h-5 w-5 text-slate-300 dark:text-slate-600" />;
}

/**
 * Assistente visual de implantação (FASE 33) — só composição de dados já existentes.
 */
export function MasterIntelligentOnboarding({
  companyId,
  journey,
  automation,
  company,
  crm,
  showWizardLink = true,
  compact = false,
  showTimelines = true,
}: Props) {
  const view = useMemo(
    () =>
      deriveIntelligentOnboarding({
        journey,
        automation,
        company,
        crm,
      }),
    [journey, automation, company, crm],
  );

  return (
    <section
      id="onboarding"
      className="scroll-mt-6 space-y-5 rounded-2xl border border-indigo-200/60 bg-gradient-to-b from-indigo-50/40 to-white p-5 dark:border-indigo-500/20 dark:from-indigo-500/5 dark:to-slate-900/50"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">
            Onboarding Inteligente
          </p>
          <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
            <Route className="h-5 w-5 text-indigo-500" />
            Jornada de implantação
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Assistente visual com base na jornada, wizard e automação já existentes — sem regras novas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MasterStatusBadge status={view.implantationStatus} />
          {showWizardLink && (
            <Link
              to={`/master/tenants/${companyId}/implantacao`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              <Rocket className="h-3.5 w-3.5" />
              Abrir assistente
            </Link>
          )}
        </div>
      </div>

      {/* Barra de progresso */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2 text-xs">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Progresso · {view.progressPercent}%
          </span>
          {view.currentLabel && (
            <span className="text-indigo-600 dark:text-indigo-300">
              Etapa atual: <strong>{view.currentLabel}</strong>
            </span>
          )}
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
            style={{ width: `${view.progressPercent}%` }}
          />
        </div>
      </div>

      {/* KPIs auxiliares */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface shadow-card px-3 py-3 ">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
            <Clock3 className="h-3.5 w-3.5" /> Tempo médio / etapa
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
            {view.averageStepLabel || '—'}
          </p>
          <p className="text-[11px] text-slate-500">
            {view.elapsedLabel ? `Decorrido: ${view.elapsedLabel}` : 'Aguardando timestamps'}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface shadow-card px-3 py-3  sm:col-span-2">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
            <ListTodo className="h-3.5 w-3.5" /> Pendências
          </p>
          {view.pending.length === 0 ? (
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">Nenhuma pendência.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {view.pending.map((p) => (
                <li
                  key={p.id}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    p.status === 'current'
                      ? 'border-indigo-400/50 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                      : p.status === 'failed'
                        ? 'border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        : 'border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  {p.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Fluxo visual vertical */}
      <div className={compact ? 'max-h-[420px] overflow-y-auto pr-1' : ''}>
        <ol className="space-y-0">
          {view.milestones.map((m, idx) => {
            const isLast = idx === view.milestones.length - 1;
            return (
              <li key={m.id} className="relative">
                <div
                  className={`flex gap-3 rounded-2xl border px-3 py-3 transition ${
                    m.status === 'current'
                      ? 'border-indigo-400/50 bg-indigo-500/10 shadow-sm'
                      : m.status === 'completed'
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : m.status === 'failed'
                          ? 'border-rose-500/25 bg-rose-500/5'
                          : 'border-slate-200/80 bg-white/70 dark:border-slate-800 dark:bg-slate-950/30'
                  }`}
                >
                  <div className="flex shrink-0 flex-col items-center pt-0.5">
                    <MilestoneIcon status={m.status} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        {m.label}
                      </span>
                      <MasterStatusBadge
                        status={
                          m.status === 'completed'
                            ? 'concluído'
                            : m.status === 'current'
                              ? 'etapa atual'
                              : m.status === 'failed'
                                ? 'falha'
                                : 'pendente'
                        }
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{m.detail}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                      {m.actor && (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" /> Quem: {m.actor}
                        </span>
                      )}
                      {m.at && (
                        <span>
                          Quando:{' '}
                          {Number.isFinite(Date.parse(m.at))
                            ? new Date(m.at).toLocaleString('pt-BR')
                            : m.at}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {!isLast && (
                  <div className="flex justify-center py-1 text-slate-300 dark:text-slate-600" aria-hidden>
                    <ArrowDown className="h-4 w-4" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {showTimelines && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface shadow-card p-4 ">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Timeline da jornada
            </h4>
            <MasterVisualTimeline items={view.timeline} empty="Sem eventos de jornada." />
          </div>
          <div className="rounded-2xl border border-border bg-surface shadow-card p-4 ">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Timeline da automação
            </h4>
            <MasterVisualTimeline
              items={view.automationTimeline}
              empty="Sem eventos de automação — confirme o pagamento manual para gerar o log."
            />
          </div>
        </div>
      )}
    </section>
  );
}
