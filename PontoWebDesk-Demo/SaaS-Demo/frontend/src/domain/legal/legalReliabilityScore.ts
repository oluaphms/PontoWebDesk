import { observabilityConsole } from '../../shared/logger/observabilityConsole';
export type LegalRiskLevel = 'LOW_RISK' | 'MODERATE_RISK' | 'HIGH_RISK' | 'CRITICAL_RISK';

export type LegalReliabilityInput = {
  integrityScore: number;
  lineageScore: number;
  monotonicityScore: number;
  replayProtectionScore: number;
  auditChainScore: number;
  temporalConfidenceScore: number;
  geoConfidenceScore: number;
  incidentHistoryScore: number;
  checksumConsistencyScore: number;
  sourceConsistencyScore: number;
};

export type LegalReliabilityReport = {
  score: number;
  risk: LegalRiskLevel;
};

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export function calculateLegalReliabilityScore(input: LegalReliabilityInput): LegalReliabilityReport {
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        avg([
          input.integrityScore,
          input.lineageScore,
          input.monotonicityScore,
          input.replayProtectionScore,
          input.auditChainScore,
          input.temporalConfidenceScore,
          input.geoConfidenceScore,
          input.incidentHistoryScore,
          input.checksumConsistencyScore,
          input.sourceConsistencyScore,
        ]),
      ),
    ),
  );
  const risk: LegalRiskLevel =
    score < 35 ? 'CRITICAL_RISK' : score < 55 ? 'HIGH_RISK' : score < 75 ? 'MODERATE_RISK' : 'LOW_RISK';
  observabilityConsole.info('[LEGAL RELIABILITY SCORE]', { score, risk });
  return { score, risk };
}

