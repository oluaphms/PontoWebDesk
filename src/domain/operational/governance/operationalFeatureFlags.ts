import {
  getOperationalFeatureFlags as getEnterpriseOperationalFlags,
  getOperationalFeatureFlag,
} from '../../../config/operationalFeatureFlags';

function envBool(key: string, defaultTrue: boolean): boolean {
  try {
    const v = import.meta.env[key as keyof ImportMetaEnv] as string | undefined;
    if (v === undefined || v === '') return defaultTrue;
    return !/^(0|false|off|no)$/i.test(String(v).trim());
  } catch {
    return defaultTrue;
  }
}

export type OperationalFeatureFlags = {
  replayOffline: boolean;
  autoRecovery: boolean;
  streamCoordinator: boolean;
  circuitBreaker: boolean;
  geoForensics: boolean;
  profiler: boolean;
  aggressiveTelemetry: boolean;
  realtimeBuffering: boolean;
};

export function getOperationalFeatureFlags(): OperationalFeatureFlags {
  const enterprise = getEnterpriseOperationalFlags();
  return {
    replayOffline: true,
    autoRecovery: true,
    streamCoordinator: getOperationalFeatureFlag('realtimeCoordinator'),
    circuitBreaker: envBool('VITE_OP_CIRCUIT_BREAKER', true),
    geoForensics: enterprise.geoForensics,
    profiler: envBool('VITE_OP_PROFILER', true),
    aggressiveTelemetry: envBool('VITE_OP_AGGRESSIVE_TELEMETRY', false),
    realtimeBuffering: envBool('VITE_OP_REALTIME_BUFFERING', true),
  };
}

export function isOperationalReplayEnabled(): boolean {
  return getOperationalFeatureFlags().replayOffline;
}

export function isOperationalAutoRecoveryEnabled(): boolean {
  return getOperationalFeatureFlags().autoRecovery;
}

export function isOperationalCircuitBreakerEnabled(): boolean {
  return getOperationalFeatureFlags().circuitBreaker;
}

export function isOperationalProfilerEnabled(): boolean {
  return getOperationalFeatureFlags().profiler;
}
