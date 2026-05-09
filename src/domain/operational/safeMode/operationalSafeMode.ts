type SafeModeReason =
  | 'incident_spike'
  | 'reconnect_storm'
  | 'massive_drift'
  | 'map_instability'
  | 'memory_pressure'
  | 'cpu_degraded'
  | 'realtime_congestion';

type SafeModeState = {
  enabled: boolean;
  reason: SafeModeReason | null;
  enabledAt: number | null;
};

const state: SafeModeState = {
  enabled: false,
  reason: null,
  enabledAt: null,
};

export function getOperationalSafeModeState(): SafeModeState {
  return { ...state };
}

export function enableOperationalSafeMode(reason: SafeModeReason): void {
  if (state.enabled && state.reason === reason) return;
  state.enabled = true;
  state.reason = reason;
  state.enabledAt = Date.now();
  console.warn('[SAFE MODE ENABLED]', { reason });
  console.warn('[SAFE MODE DEGRADED RUNTIME]', {
    reduce_realtime: true,
    reduce_refresh: true,
    freeze_heavy_enrich: true,
    suspend_secondary_geo: true,
    increase_debounce: true,
    simplify_map_render: true,
  });
}

export function disableOperationalSafeMode(): void {
  if (!state.enabled) return;
  state.enabled = false;
  const reason = state.reason;
  state.reason = null;
  state.enabledAt = null;
  console.info('[SAFE MODE DISABLED]', { reason });
}

