import React, { useCallback, useEffect, useState } from 'react';
import { isHelpDebugEnabled, PW_CHECKLIST_COMPLETED, PW_MATURITY_UPDATED } from '../../help/helpEvents';
import { getDailyChecklistDoneIds, getDailyChecklistProgressPercent } from '../../help/helpDailyChecklist';
import { getMaturityHistory } from '../../help/helpMaturityHistory';
import { getBehaviorSuggestions } from '../../help/helpBehaviorTracker';
import { computeOperationalMaturity } from '../../help/operationalMaturityEngine';
import { buildHelpInsightsFromContext } from '../../help/helpInsightsEngine';
import { getOnboardingStep, isOnboardingCompleted } from '../../help/helpProgress';
import { ONBOARDING_TOTAL } from '../../help/onboardingSteps';

interface HelpDebugPanelProps {
  companyId?: string;
  totalEmployees?: number;
}

export const HelpDebugPanel: React.FC<HelpDebugPanelProps> = ({ companyId, totalEmployees = 0 }) => {
  const [enabled, setEnabled] = useState(isHelpDebugEnabled);
  const [, tick] = useState(0);
  const refresh = useCallback(() => tick((n) => n + 1), []);

  useEffect(() => {
    const onMaturity = () => refresh();
    const onChecklist = () => refresh();
    window.addEventListener(PW_MATURITY_UPDATED, onMaturity);
    window.addEventListener(PW_CHECKLIST_COMPLETED, onChecklist);
    return () => {
      window.removeEventListener(PW_MATURITY_UPDATED, onMaturity);
      window.removeEventListener(PW_CHECKLIST_COMPLETED, onChecklist);
    };
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setEnabled(isHelpDebugEnabled()), 2000);
    return () => window.clearInterval(id);
  }, []);

  if (!enabled) return null;

  const history = getMaturityHistory();
  const lastScore = history.length ? history[history.length - 1].score : null;
  const onboardingProgressPercent = isOnboardingCompleted()
    ? 100
    : Math.round((getOnboardingStep() / ONBOARDING_TOTAL) * 100);
  const maturity = computeOperationalMaturity({
    insights: buildHelpInsightsFromContext({ totalEmployees }),
    totalEmployees,
    onboardingProgressPercent,
    dailyChecklistPercent: getDailyChecklistProgressPercent(),
  });
  const suggestions = getBehaviorSuggestions();

  return (
    <aside className="fixed bottom-4 right-4 z-[9999] max-w-sm rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/90 p-4 shadow-lg text-xs font-mono text-amber-950 dark:text-amber-100">
      <p className="font-bold mb-2">[HELP DEBUG]</p>
      <ul className="space-y-1">
        <li>company: {companyId ?? '—'}</li>
        <li>score (history): {lastScore ?? '—'}</li>
        <li>score (calc): {maturity.score}</li>
        <li>level: {maturity.level}</li>
        <li>checklist: {getDailyChecklistProgressPercent()}% — {getDailyChecklistDoneIds().join(', ') || 'vazio'}</li>
        <li>issues: {maturity.issues.map((i) => i.id).join(', ') || 'nenhum'}</li>
        <li>insights: {suggestions.map((s) => s.message).join(' | ') || 'nenhum'}</li>
      </ul>
    </aside>
  );
};

export default HelpDebugPanel;
