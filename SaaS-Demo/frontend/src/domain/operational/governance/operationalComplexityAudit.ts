import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
type ComplexityLevel = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export type OperationalComplexityInput = {
  activeWatchers: number;
  activeListeners: number;
  realtimePipelines: number;
  invalidationsPerMin: number;
  recoveryLoopsPerHour: number;
  activeResolvers: number;
  activeClocks: number;
  duplicateWatcherHits: number;
  redundantRealtimeHits: number;
};

export type OperationalComplexityReport = {
  score: number;
  level: ComplexityLevel;
  findings: string[];
};

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function runOperationalComplexityAudit(input: OperationalComplexityInput): OperationalComplexityReport {
  let score = 100;
  const findings: string[] = [];
  if (input.activeWatchers > 8) {
    score -= 12;
    findings.push('watchers_above_budget');
    observabilityConsole.warn('[DUPLICATE WATCHER DETECTED]', { active_watchers: input.activeWatchers });
  }
  if (input.activeListeners > 24) {
    score -= 10;
    findings.push('listeners_above_budget');
  }
  if (input.realtimePipelines > 1 || input.redundantRealtimeHits > 0) {
    score -= 20;
    findings.push('redundant_realtime_pipeline');
    observabilityConsole.warn('[REDUNDANT REALTIME PIPELINE]', {
      realtime_pipelines: input.realtimePipelines,
      redundant_hits: input.redundantRealtimeHits,
    });
  }
  if (input.invalidationsPerMin > 80) {
    score -= 16;
    findings.push('invalidations_storm');
  }
  if (input.recoveryLoopsPerHour > 25) {
    score -= 14;
    findings.push('recovery_loop_risk');
  }
  if (input.activeResolvers > 1) {
    score -= 15;
    findings.push('multiple_resolvers_active');
  }
  if (input.activeClocks > 1) {
    score -= 10;
    findings.push('multiple_clocks_active');
  }
  if (input.duplicateWatcherHits > 0) {
    score -= 8;
    findings.push('duplicate_watcher_hits');
  }

  const finalScore = clamp(score);
  const level: ComplexityLevel = finalScore < 45 ? 'CRITICAL' : finalScore < 75 ? 'WARNING' : 'HEALTHY';
  if (level !== 'HEALTHY') {
    observabilityConsole.warn('[OPERATIONAL COMPLEXITY DETECTED]', {
      operational_complexity_score: finalScore,
      level,
      findings,
    });
  }
  return { score: finalScore, level, findings };
}

