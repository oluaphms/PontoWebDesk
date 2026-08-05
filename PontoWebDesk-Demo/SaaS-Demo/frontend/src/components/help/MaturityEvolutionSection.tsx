import React, { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  detectOperationalRegression,
  getPreviousAlertsSnapshot,
} from '../../help/helpRegressionDetector';
import { useLiveMaturityScore } from '../../help/useLiveMaturityScore';
import { MaturityTimelineChart } from './MaturityTimelineChart';
import { RegressionAlertBanner } from './RegressionAlertBanner';
import { WeeklySummaryCard } from './WeeklySummaryCard';

interface MaturityEvolutionSectionProps {
  openAlertsCount: number;
}

export const MaturityEvolutionSection: React.FC<MaturityEvolutionSectionProps> = ({
  openAlertsCount,
}) => {
  const score = useLiveMaturityScore();

  const regression = useMemo(
    () =>
      score !== null
        ? detectOperationalRegression({
            currentScore: score,
            openAlertsCount,
            previousAlertsCount: getPreviousAlertsSnapshot(),
          })
        : null,
    [score, openAlertsCount],
  );

  if (score === null) return null;

  return (
    <div className="space-y-4">
      {regression && <RegressionAlertBanner alert={regression} />}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Linha do tempo de evolução</h3>
        </div>
        <MaturityTimelineChart />
      </section>
      <WeeklySummaryCard currentScore={score} />
    </div>
  );
};

export default MaturityEvolutionSection;
