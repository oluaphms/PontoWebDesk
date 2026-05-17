import React, { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiQueryKeys } from '../../lib/apiQueryKeys';
import { fetchOperationalAlerts } from '../../services/operationalAlerts.service';
import { PW_MATURITY_UPDATED, LEGACY_MATURITY_UPDATED, dispatchPwAchievementUnlocked } from '../../help/helpEvents';
import { checkAndUnlockAchievements } from '../../help/helpAchievements';
import { getInitialMaturityScore } from '../../help/helpMaturityHistory';
import {
  getPreviousAlertsSnapshot,
  snapshotAlertsCount,
} from '../../help/helpRegressionDetector';
import { useLiveMaturityScore } from '../../help/useLiveMaturityScore';
import { MaturityBenchmarkBlock } from './MaturityBenchmarkBlock';
import { MaturityEvolutionSection } from './MaturityEvolutionSection';
import { AchievementsPanel } from './AchievementsPanel';

interface MaturityEngagementPanelsProps {
  companyId: string;
  openAlertsCount?: number;
}

/** @deprecated Use página Inteligência Operacional; mantido para compatibilidade. */
export const MaturityEngagementPanels: React.FC<MaturityEngagementPanelsProps> = ({
  companyId,
  openAlertsCount: openAlertsProp,
}) => {
  const alertsQ = useQuery({
    queryKey: apiQueryKeys.operationalAlerts(companyId),
    queryFn: () => fetchOperationalAlerts(companyId),
    enabled: !!companyId,
    staleTime: 8000,
  });
  const openAlertsCount =
    openAlertsProp ?? (alertsQ.data?.filter((a) => !a.resolved).length ?? 0);
  const score = useLiveMaturityScore();
  const [newAchievements, setNewAchievements] = useState<string[]>([]);

  const checkAchievements = useCallback(() => {
    if (score === null) return;
    const initial = getInitialMaturityScore();
    const newly = checkAndUnlockAchievements({
      score,
      openAlertsCount,
      previousOpenAlertsCount: getPreviousAlertsSnapshot(),
      scoreImprovedFromInitial: initial !== null && score - initial >= 10,
    });
    if (newly.length) {
      setNewAchievements((prev) => [...new Set([...prev, ...newly])]);
      dispatchPwAchievementUnlocked({ ids: newly });
    }
    snapshotAlertsCount(openAlertsCount);
  }, [score, openAlertsCount]);

  useEffect(() => {
    checkAchievements();
    const onUpdate = () => checkAchievements();
    window.addEventListener(PW_MATURITY_UPDATED, onUpdate);
    window.addEventListener(LEGACY_MATURITY_UPDATED, onUpdate);
    return () => {
      window.removeEventListener(PW_MATURITY_UPDATED, onUpdate);
      window.removeEventListener(LEGACY_MATURITY_UPDATED, onUpdate);
    };
  }, [checkAchievements]);

  if (score === null) return null;

  return (
    <div className="space-y-4">
      <MaturityBenchmarkBlock />
      <MaturityEvolutionSection companyId={companyId} />
      <AchievementsPanel newlyUnlocked={newAchievements} />
    </div>
  );
};

export default MaturityEngagementPanels;
