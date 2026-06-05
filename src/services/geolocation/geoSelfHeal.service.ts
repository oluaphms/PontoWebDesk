import { invalidateOperationalGeoCaches, invalidateRealtimeGeoEntity } from '../queryCache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshCurrentOperationalStateRpc } from '../currentOperationalState.service';
import { reconcileCurrentOperationalState } from '../../domain/operational/reconciliation/currentOperationalStateReconciler';
import { getSupabaseClient } from '../supabaseClient';
import { getRealtimeGeoStreamCoordinator } from '../monitoring/realtimeGeoStreamCoordinator';
import { opLog } from '../../utils/operationalLogger';

/**
 * Lock anti-cascata. Sem isso, se o self-heal disparar invalidações que provocam
 * outro detect → outro self-heal, vira "tempestade de cura": dezenas de RPCs `refresh_current_operational_state`
 * por segundo e re-render de monitoramento em loop.
 */
const SELF_HEAL_ACTIVE_TTL_MS = 30_000;
const activeSelfHeal = new Map<string, number>();

function healKey(companyId: string | null | undefined, employeeId: string): string {
  return `${companyId ?? 'no_company'}:${employeeId}`;
}

function isSelfHealActive(key: string, now: number): boolean {
  const startedAt = activeSelfHeal.get(key);
  if (startedAt == null) return false;
  if (now - startedAt > SELF_HEAL_ACTIVE_TTL_MS) {
    activeSelfHeal.delete(key);
    return false;
  }
  return true;
}

export function __resetSelfHealLockForTests(): void {
  activeSelfHeal.clear();
}

export async function runGeoSelfHeal(input: {
  companyId?: string | null;
  employeeId: string;
  reason: string;
}): Promise<void> {
  const key = healKey(input.companyId, input.employeeId);
  const now = Date.now();
  if (isSelfHealActive(key, now)) {
    opLog.debug('GEO SELF HEAL SKIPPED', { ...input, reason_skip: 'active_within_ttl' });
    return;
  }
  activeSelfHeal.set(key, now);

  opLog.warn('GEO SELF HEAL START', input);
  try {
    invalidateRealtimeGeoEntity(input.employeeId, input.companyId ?? undefined);
    invalidateOperationalGeoCaches(`geo_self_heal:${input.reason}`);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('smartponto:force-monitoring-refresh', {
          detail: { companyId: input.companyId, employeeId: input.employeeId, source: 'geo_self_heal', reason: input.reason },
        }),
      );
    }
    if (input.companyId) {
      const client = getSupabaseClient() as unknown as SupabaseClient | null;
      await refreshCurrentOperationalStateRpc(input.companyId, input.employeeId, { force: true, source: 'geo_self_heal', client });
      if (client) {
        await reconcileCurrentOperationalState(client, input.companyId, [input.employeeId]);
      }
      getRealtimeGeoStreamCoordinator(input.companyId).requestFlush('geo_self_heal', () => undefined);
    }
    opLog.warn('GEO SELF HEAL SUCCESS', input);
  } catch (error) {
    opLog.error('GEO SELF HEAL FAILED', { ...input, error: String(error) });
  } finally {
    setTimeout(() => {
      activeSelfHeal.delete(key);
    }, SELF_HEAL_ACTIVE_TTL_MS);
  }
}
