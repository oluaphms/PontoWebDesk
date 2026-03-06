import { useState, useEffect, useCallback } from 'react';
import { db, isSupabaseConfigured } from '../../services/supabase';
import { NotificationService } from '../../services/notificationService';
import type { User } from '../../types';

export interface NavigationBadges {
  requestsCount: number;
  notificationsCount: number;
}

export function useNavigationBadges(user: User | null): NavigationBadges {
  const [requestsCount, setRequestsCount] = useState(0);
  const [notificationsCount, setNotificationsCount] = useState(0);

  const load = useCallback(async () => {
    if (!user) {
      setRequestsCount(0);
      setNotificationsCount(0);
      return;
    }

    const isAdmin = user.role === 'admin' || user.role === 'hr';

    if (isSupabaseConfigured) {
      try {
        const filters: { column: string; operator: string; value: unknown }[] = [
          { column: 'status', operator: 'eq', value: 'pending' },
        ];
        if (!isAdmin) {
          filters.push({ column: 'user_id', operator: 'eq', value: user.id });
        }
        const rows = (await db.select('requests', filters, undefined, 1000)) ?? [];
        setRequestsCount(Array.isArray(rows) ? rows.length : 0);
      } catch {
        setRequestsCount(0);
      }

      try {
        const count = await NotificationService.getUnreadCount(user.id);
        setNotificationsCount(count);
      } catch {
        setNotificationsCount(0);
      }
    } else {
      setRequestsCount(0);
      setNotificationsCount(0);
    }
  }, [user]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  return { requestsCount, notificationsCount };
}
