import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../../services/supabase';
import { NotificationService } from '../../services/notificationService';
import { requestsQueries } from '../../services/queryOptimizations';
import type { User } from '../../types';
import { getAdaptiveRefetchIntervalMs, isPollingSuppressedByVisibility } from '../performance/pollingGovernor';
import { isPostLoginQueryCooldownActive } from '../app/postLoginQueryGate';
import { isRestrictedBootstrapMode } from '../performance/networkMode';

export interface NavigationBadges {
  requestsCount: number;
  notificationsCount: number;
}

export function useNavigationBadges(user: User | null): NavigationBadges {
  const pollMs = getAdaptiveRefetchIntervalMs(60 * 1000);
  const [restrictedGate, setRestrictedGate] = useState(!isRestrictedBootstrapMode());

  useEffect(() => {
    if (!isRestrictedBootstrapMode()) {
      setRestrictedGate(true);
      return;
    }
    setRestrictedGate(false);
    const t = window.setTimeout(() => setRestrictedGate(true), 3400);
    return () => window.clearTimeout(t);
  }, [user?.id]);

  const queriesEnabled =
    !!user &&
    isSupabaseConfigured() &&
    !isPostLoginQueryCooldownActive() &&
    restrictedGate;

  const { data: requestsCount = 0 } = useQuery({
    queryKey: ['requests-count', user?.id],
    queryFn: () => user ? requestsQueries.countPendingRequests(user.id).then(r => r.count || 0) : Promise.resolve(0),
    enabled: queriesEnabled,
    staleTime: 1 * 60 * 1000, // 1 minuto
    refetchInterval: () => (isPollingSuppressedByVisibility() ? false : pollMs),
  });

  const { data: notificationsCount = 0 } = useQuery({
    queryKey: ['notifications-count', user?.id],
    queryFn: () => user ? NotificationService.getUnreadCount(user.id) : Promise.resolve(0),
    enabled: queriesEnabled,
    staleTime: 1 * 60 * 1000, // 1 minuto
    refetchInterval: () => (isPollingSuppressedByVisibility() ? false : pollMs),
  });

  return { requestsCount, notificationsCount };
}
