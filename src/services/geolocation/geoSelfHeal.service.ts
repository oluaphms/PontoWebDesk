import { invalidateOperationalGeoCaches, invalidateRealtimeGeoEntity } from '../queryCache';
import { refreshCurrentOperationalStateRpc } from '../currentOperationalState.service';
import { reconcileCurrentOperationalState } from '../../domain/operational/reconciliation/currentOperationalStateReconciler';
import { getSupabaseClient } from '../supabaseClient';
import { getRealtimeGeoStreamCoordinator } from '../monitoring/realtimeGeoStreamCoordinator';

export async function runGeoSelfHeal(input: {
  companyId?: string | null;
  employeeId: string;
  reason: string;
}): Promise<void> {
  console.warn('[GEO SELF HEAL START]', input);
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
      const client = getSupabaseClient();
      await refreshCurrentOperationalStateRpc(input.companyId, input.employeeId, { force: true, source: 'geo_self_heal', client });
      if (client) {
        await reconcileCurrentOperationalState(client, input.companyId, [input.employeeId]);
      }
      getRealtimeGeoStreamCoordinator(input.companyId).requestFlush('geo_self_heal', () => undefined);
    }
    console.info('[GEO SELF HEAL SUCCESS]', input);
  } catch (error) {
    console.error('[GEO SELF HEAL FAILED]', { ...input, error: String(error) });
  }
}

