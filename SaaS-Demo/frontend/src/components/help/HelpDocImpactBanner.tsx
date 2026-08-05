import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import type { HelpDocSlug } from '../../help/helpCenterCatalog';
import { getDocImpactContext } from '../../help/helpImpactConnector';
import { getDailyChecklistProgressPercent } from '../../help/helpDailyChecklist';
import { getOnboardingStep, isOnboardingCompleted } from '../../help/helpProgress';
import { ONBOARDING_TOTAL } from '../../help/onboardingSteps';
import type { OperationalBundle } from '../../hooks/useOperationalBundle';

interface HelpDocImpactBannerProps {
  doc: HelpDocSlug;
  bundle?: OperationalBundle | null;
}

export const HelpDocImpactBanner: React.FC<HelpDocImpactBannerProps> = ({ doc, bundle }) => {
  const impact = useMemo(() => {
    if (!bundle || bundle.isLoading) {
      return getDocImpactContext(doc);
    }
    const onboardingProgressPercent = isOnboardingCompleted()
      ? 100
      : Math.round((getOnboardingStep() / ONBOARDING_TOTAL) * 100);
    return getDocImpactContext(doc, {
      alerts: bundle.alerts,
      status: bundle.status,
      tasks: bundle.tasks,
      risk: bundle.risk,
      insights: bundle.insights,
      totalEmployees: bundle.totalEmployees,
      onboardingProgressPercent,
      dailyChecklistPercent: getDailyChecklistProgressPercent(),
    });
  }, [doc, bundle]);

  return (
    <section className="mb-6 rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/60 dark:bg-violet-950/25 p-4">
      <div className="flex items-start gap-3">
        <BarChart3 className="w-5 h-5 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300 mb-2">
            Impacto no seu sistema
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-300">{impact.summaryLine}</p>
          <ul className="mt-2 text-sm text-slate-600 dark:text-slate-400 space-y-1">
            <li>
              • Esse tema afeta sua maturidade em até <strong>{impact.maturityPoints}</strong> pontos
            </li>
            {impact.relatedChecklist.length > 0 && (
              <li>• Relacionado ao checklist: {impact.relatedChecklist.join(', ')}</li>
            )}
            {impact.activeDiagnostics.length > 0 && (
              <li>• Diagnóstico ativo: {impact.activeDiagnostics[0]}</li>
            )}
          </ul>
          <Link
            to="/admin/inteligencia-operacional"
            className="inline-block mt-3 text-sm font-medium text-violet-700 dark:text-violet-300 hover:underline"
          >
            Abrir Inteligência Operacional →
          </Link>
        </div>
      </div>
    </section>
  );
};

export default HelpDocImpactBanner;
