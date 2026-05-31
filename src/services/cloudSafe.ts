import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { isCloudEnabled } from './cloudService';
import { enableDegradedMode } from './systemMode';
import { isSupabaseBlocked } from '../utils/supabaseGuard';

export async function cloudSafe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!isCloudEnabled()) return fallback;

  try {
    return await fn();
  } catch (e: unknown) {
    if (isSupabaseBlocked(e)) {
      enableDegradedMode();
      observabilityConsole.warn('[MODO LOCAL]');
      return fallback;
    }
    throw e;
  }
}
