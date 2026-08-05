import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
/**
 * Recuperação automática coordenada após degradação (circuit half-open / reconexão).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { invalidateOperationalGeoCaches } from '../../../services/queryCache';
import { operationalBusEmit } from '../bus/operationalEventBus';
import { notifyGeoCircuitSuccess } from '../geo/geoOperationalCircuitBreaker';
import { replayOfflineGeoOperationalBuffer } from '../../../services/geolocation/offlineGeoOperationalBuffer';
import { getOperationalMonitoringIdentity } from '../../../performance/operationalMonitoringContext';
import { isOperationalAutoRecoveryEnabled } from '../governance/operationalFeatureFlags';

let recoveryInflight = false;
let lastRecoveryAt = 0;
const COOLDOWN_MS = 25_000;

export async function coordinateOperationalAutoRecovery(
  reason: string,
  client: SupabaseClient | null,
): Promise<void> {
  if (!isOperationalAutoRecoveryEnabled()) return;
  const t = Date.now();
  if (recoveryInflight || t - lastRecoveryAt < COOLDOWN_MS) return;
  recoveryInflight = true;
  lastRecoveryAt = t;
  observabilityConsole.info('[AUTO RECOVERY START]', { reason });
  operationalBusEmit('recovery:started', { reason });
  try {
    invalidateOperationalGeoCaches(`auto_recovery:${reason}`);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('smartponto:force-monitoring-refresh', { detail: { source: 'auto_recovery', reason } }),
      );
    }
    const id = getOperationalMonitoringIdentity();
    if (id && client) {
      await replayOfflineGeoOperationalBuffer({ companyId: id.companyId, employeeId: id.employeeId, client });
    }
    notifyGeoCircuitSuccess();
    observabilityConsole.info('[AUTO RECOVERY SUCCESS]', { reason });
  } catch (e) {
    observabilityConsole.error('[AUTO RECOVERY FAILED]', { reason, error: String(e) });
  } finally {
    recoveryInflight = false;
  }
}
