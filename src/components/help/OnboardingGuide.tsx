import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, GraduationCap, X } from 'lucide-react';
import { ONBOARDING_STEPS, ONBOARDING_TOTAL } from '../../help/onboardingSteps';
import {
  getOnboardingStep,
  isOnboardingCompleted,
  setOnboardingCompleted,
  setOnboardingStep,
} from '../../help/helpProgress';
import { openHelp } from '../../help/openHelp';
import { trackHelpAnalytics } from '../../help/helpAnalytics';

interface OnboardingGuideProps {
  /** Exibir quando empresa ainda não tem colaboradores */
  showWhenEmpty?: boolean;
  totalEmployees?: number;
}

export const OnboardingGuide: React.FC<OnboardingGuideProps> = ({
  showWhenEmpty = true,
  totalEmployees = 0,
}) => {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [stepIndex, setStepIndex] = useState(() => getOnboardingStep());

  const visible = useMemo(() => {
    if (dismissed || isOnboardingCompleted()) return false;
    if (showWhenEmpty && totalEmployees > 0) return false;
    return true;
  }, [dismissed, showWhenEmpty, totalEmployees]);

  if (!visible) return null;

  const step = ONBOARDING_STEPS[Math.min(stepIndex, ONBOARDING_STEPS.length - 1)];
  const stepNum = stepIndex + 1;

  const openGuide = () => {
    trackHelpAnalytics('onboarding_step_viewed', { step: stepNum, doc: step.doc });
    openHelp(step.doc, navigate, { section: 'como-usar', resolveSection: true });
  };

  const nextStep = () => {
    const next = stepIndex + 1;
    if (next >= ONBOARDING_TOTAL) {
      setOnboardingCompleted();
      trackHelpAnalytics('onboarding_completed');
      setDismissed(true);
      return;
    }
    setStepIndex(next);
    setOnboardingStep(next);
    trackHelpAnalytics('onboarding_step_viewed', { step: next + 1, doc: ONBOARDING_STEPS[next].doc });
  };

  const skip = () => {
    setOnboardingCompleted();
    setDismissed(true);
  };

  return (
    <div className="rounded-2xl border border-violet-200 dark:border-violet-900/50 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/40 dark:to-indigo-950/30 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 flex items-center justify-center shrink-0 shadow-sm">
        <GraduationCap className="w-6 h-6 text-violet-600 dark:text-violet-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
          Primeiros passos — Passo {stepNum} de {ONBOARDING_TOTAL}
        </p>
        <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{step.title}</p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{step.description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={openGuide}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors"
        >
          Abrir guia
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          onClick={nextStep}
          className="px-3 py-2 rounded-xl text-sm font-medium text-violet-700 dark:text-violet-300 bg-white/80 dark:bg-slate-900/50 border border-violet-200 dark:border-violet-800 hover:bg-white transition-colors"
        >
          {stepNum >= ONBOARDING_TOTAL ? 'Concluir' : 'Próximo'}
        </button>
        <button type="button" onClick={skip} className="p-2 text-slate-400 hover:text-slate-600" aria-label="Pular onboarding">
          <X size={16} />
        </button>
      </div>
    </div>
  );
};
