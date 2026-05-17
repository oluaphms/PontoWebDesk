import type { MaturityLevel } from '../help/operationalMaturityEngine';
import type { OperationalDiagnosticItem } from '../help/helpDiagnosticEngine';
import type { BenchmarkComparison } from '../help/operationalBenchmarkEngine';

/** Item do checklist diário persistível (espelho futuro em backend). */
export interface OperationalChecklistSnapshotItem {
  id: string;
  label: string;
  done: boolean;
}

/** Conquista desbloqueada no snapshot. */
export interface OperationalAchievementSnapshotItem {
  id: string;
  title: string;
  unlocked: boolean;
}

/** Problema / insight no snapshot. */
export type OperationalIssueSnapshot = OperationalDiagnosticItem;

/**
 * Snapshot operacional completo — pronto para persistência em API futura.
 */
export interface OperationalSnapshot {
  company_id: string;
  score: number;
  level: MaturityLevel;
  benchmark_percentile: number;
  benchmark_comparison: BenchmarkComparison;
  issues: OperationalIssueSnapshot[];
  checklist: OperationalChecklistSnapshotItem[];
  achievements: OperationalAchievementSnapshotItem[];
  evolution_message: string | null;
  impact_phrase: string;
  generated_at: string;
}

export interface OperationalReportPayload {
  snapshot: OperationalSnapshot;
  markdown: string;
  json: string;
}
