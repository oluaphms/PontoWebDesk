import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiQueryKeys } from '../lib/apiQueryKeys';
import { fetchOperationalAlerts } from '../services/operationalAlerts.service';
import { checkAndUnlockAchievements } from './helpAchievements';
import { getInitialMaturityScore } from './helpMaturityHistory';
import {
  getPreviousAlertsSnapshot,
  snapshotAlertsCount,
} from './helpRegressionDetector';
import { useLiveMaturityScore } from './useLiveMaturityScore';
import {
  dispatchPwAchievementUnlocked,
  LEGACY_MATURITY_UPDATED,
  PW_MATURITY_UPDATED,
} from './helpEvents';

export function useOperationalAchievementUnlock(companyId: string): string[] {
  const score = useLiveMaturityScore();
  const alertsQ = useQuery({
    queryKey: apiQueryKeys.operationalAlerts(companyId),
    queryFn: () => fetchOperationalAlerts(companyId),
    enabled: !!companyId,
    staleTime: 8000,
  });
  const openAlertsCount = alertsQ.data?.filter((a) => !a.resolved).length ?? 0;
  const [newlyUnlocked, setNewlyUnlocked] = useState<string[]>([]);

  const check = useCallback(() => {
    if (score === null) return;
    const initial = getInitialMaturityScore();
    const ids = checkAndUnlockAchievements({
      score,
      openAlertsCount,
      previousOpenAlertsCount: getPreviousAlertsSnapshot(),
      scoreImprovedFromInitial: initial !== null && score - initial >= 10,
    });
    if (ids.length) {
      setNewlyUnlocked((prev) => [...new Set([...prev, ...ids])]);
      dispatchPwAchievementUnlocked({ ids });
    }
    snapshotAlertsCount(openAlertsCount);
  }, [score, openAlertsCount]);

  useEffect(() => {
    check();
    const onUpdate = () => check();
    window.addEventListener(PW_MATURITY_UPDATED, onUpdate);
    window.addEventListener(LEGACY_MATURITY_UPDATED, onUpdate);
    return () => {
      window.removeEventListener(PW_MATURITY_UPDATED, onUpdate);
      window.removeEventListener(LEGACY_MATURITY_UPDATED, onUpdate);
    };
  }, [check]);

  return newlyUnlocked;
}
