import { useEffect, useState } from 'react';
import { isDegradedMobileRuntime } from '../performance/mobileCpuBudget';
import { isLowNetworkMode } from '../performance/networkMode';

/**
 * Atrasa chrome operacional (badges, polling leve, etc.) até idle pós-login — shell primeiro.
 */
export function useDeferredPortalChrome(userId: string | undefined, idleTimeoutMs = 600): boolean {
  const [ready, setReady] = useState(false);
  const budget =
    isDegradedMobileRuntime() || isLowNetworkMode() ? Math.max(idleTimeoutMs, 1800) : idleTimeoutMs;

  useEffect(() => {
    if (!userId) {
      setReady(false);
      return;
    }
    setReady(false);
    const w = typeof window !== 'undefined' ? window : undefined;
    if (!w) {
      setReady(true);
      return;
    }
    const finish = () => setReady(true);
    if ('requestIdleCallback' in w) {
      const id = w.requestIdleCallback(finish, { timeout: budget });
      return () => w.cancelIdleCallback(id);
    }
    const t = w.setTimeout(finish, Math.min(400, budget));
    return () => w.clearTimeout(t);
  }, [userId, budget]);

  return ready;
}
